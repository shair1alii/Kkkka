import Busboy from "busboy";
import FormData from "form-data";
import fetch from "node-fetch";

export const config = {
  api: {
    bodyParser: false
  }
};

const TELEGRAM_BASE = "https://api.telegram.org";

export default async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: "Missing BOT_TOKEN env var" });
  }

  try {
    // JSON body handling (text / location / other small JSON payloads)
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/json")) {
      // collect body
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const data = JSON.parse(raw);

      // determine telegram method
      let methodPath;
      if (data.type === "text" || data.text) methodPath = `bot${BOT_TOKEN}/sendMessage`;
      else if (data.type === "location") methodPath = `bot${BOT_TOKEN}/sendLocation`;
      else methodPath = data.method ? `bot${BOT_TOKEN}/${data.method}` : null;

      if (!methodPath) return res.status(400).send("Invalid JSON payload");

      const tgRes = await fetch(`${TELEGRAM_BASE}/${methodPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const text = await tgRes.text();
      return res.status(tgRes.status).send(text);
    }

    // multipart/form-data handling (photo/voice/audio)
    if (req.method === "POST") {
      const bb = Busboy({ headers: req.headers });
      const fields = {};
      let fileBuffers = []; // support single file upload
      let fileInfo = null;

      await new Promise((resolve, reject) => {
        bb.on("field", (name, val) => {
          fields[name] = val;
        });

        bb.on("file", (name, file, info) => {
          const chunks = [];
          file.on("data", (d) => chunks.push(d));
          file.on("end", () => {
            fileBuffers.push(Buffer.concat(chunks));
            fileInfo = { fieldname: name, filename: info.filename, mime: info.mimeType || info.mimetype || "application/octet-stream" };
          });
        });

        bb.on("close", resolve);
        bb.on("error", reject);

        req.pipe(bb);
      });

      const chat_id = fields.chat_id || fields.chatId || fields.chat;
      const type = fields.type || fields.filetype || fields.mediaType || "photo";
      if (!chat_id) return res.status(400).send("Missing chat_id");
      if (!fileBuffers.length) return res.status(400).send("Missing file upload");

      // choose telegram endpoint
      let tgMethod;
      if (type === "photo") tgMethod = `bot${BOT_TOKEN}/sendPhoto`;
      else if (type === "voice") tgMethod = `bot${BOT_TOKEN}/sendVoice`;
      else if (type === "audio") tgMethod = `bot${BOT_TOKEN}/sendAudio`;
      else if (type === "document") tgMethod = `bot${BOT_TOKEN}/sendDocument`;
      else tgMethod = `bot${BOT_TOKEN}/sendDocument`; // fallback

      const fd = new FormData();
      fd.append("chat_id", chat_id);
      // append file (first uploaded file)
      fd.append(type === "photo" ? "photo" : (type === "voice" ? "voice" : (type === "audio" ? "audio" : "document")),
                fileBuffers[0], { filename: fileInfo.filename || "file.bin", contentType: fileInfo.mime });

      // if there are any extra fields to forward
      Object.keys(fields).forEach(k => {
        if (k !== "chat_id" && k !== "type") fd.append(k, fields[k]);
      });

      const tgRes = await fetch(`${TELEGRAM_BASE}/${tgMethod}`, {
        method: "POST",
        body: fd,
        headers: fd.getHeaders ? fd.getHeaders() : {}
      });

      const text = await tgRes.text();
      return res.status(tgRes.status).send(text);
    }

    return res.status(400).send("Unsupported request");
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy failed", details: err.message });
  }
}
