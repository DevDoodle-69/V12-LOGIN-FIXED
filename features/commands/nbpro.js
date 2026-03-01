const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

module.exports = {
  config: {
    name: "nbpro2",
    aliases: [],
    version: "1.4",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Gemini 3.1 4K Images" },
    longDescription: { en: "Generate 4K Landscape images using Gemini 3.1 Flash" },
    category: "AI",
    guide: { en: "{prefix}nbpro2 <prompt> --num 1-4 --natural|--vivid" }
  },

  async autoCleanup(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (now - fs.statSync(p).mtime.getTime() > 20 * 60 * 1000) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
  },

  async process(buf, meta, w, h) {
    const r1 = w / h;
    const r2 = meta.width / meta.height;
    const crop = r2 > r1
      ? { width: Math.round(meta.height * r1), height: meta.height, left: Math.round((meta.width - meta.height * r1) / 2), top: 0 }
      : { width: meta.width, height: Math.round(meta.width / r1), left: 0, top: Math.round((meta.height - meta.width / r1) / 2) };

    return sharp(buf).extract(crop).resize(w, h).png({ quality: 100 }).toBuffer();
  },

  async grid(images, w, h, cw, ch) {
    return sharp({
      create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } }
    })
      .composite(images.map((b, i) => ({
        input: b,
        left: (i % 2) * cw,
        top: Math.floor(i / 2) * ch
      })))
      .png()
      .toBuffer();
  },

  async handleReply({ api, event, data }) {
    const { threadID, messageID } = event;
    const { buffers } = data;
    const index = parseInt(event.body) - 1;
    if (isNaN(index) || index < 0 || index >= buffers.length) {
      return api.sendMessage("Invalid selection.", threadID, messageID);
    }
    const imagesDir = path.join(__dirname, "images");
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    const outPath = path.join(imagesDir, `${Date.now()}.png`);
    fs.writeFileSync(outPath, buffers[index]);
    return api.sendMessage(
      { attachment: fs.createReadStream(outPath) },
      threadID,
      () => setTimeout(() => { try { fs.unlinkSync(outPath); } catch {} }, 2 * 60 * 1000),
      messageID
    );
  },

  async onStart({ api, event, args, commandHandler }) {
    const { threadID, messageID, senderID } = event;
    if (!args.length) return;

    let text = args.join(" ");
    let num = 1;
    let style = "vivid";

    if (text.includes("--natural")) {
      style = "natural";
      text = text.replace("--natural", "").trim();
    }
    if (text.includes("--vivid")) {
      style = "vivid";
      text = text.replace("--vivid", "").trim();
    }

    const nm = text.match(/--num\s*([1-4])/i);
    if (nm) {
      num = parseInt(nm[1]);
      text = text.replace(nm[0], "").trim();
    }

    if (!text) return;

    const W = 3840;
    const H = 2160;
    const sizeParam = "1792x1024";
    const imagesDir = path.join(__dirname, "images");
    await this.autoCleanup(imagesDir);

    try {
      const requests = [];
      for (let i = 0; i < num; i++) {
        requests.push(axios.post("https://api-reverse-engineering.kines966176.workers.dev/v1/images/generations", {
          model: "gemini-3.1-flash-image-preview",
          prompt: text,
          n: 1,
          size: sizeParam,
          quality: "hd",
          style: style,
          contents: [{ role: "user", parts: [{ text: `Generate an image of: ${text}` }] }]
        }, {
          headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-9661" }
        }));
      }

      const responses = await Promise.all(requests);
      const buffers = responses
        .map(res => {
          const imageData = res.data && res.data.data && res.data.data[0];
          if (imageData && imageData.b64_json) {
            return Buffer.from(imageData.b64_json, 'base64');
          }
          console.error("Invalid response format from image API:", JSON.stringify(res.data));
          return null;
        })
        .filter(b => b !== null);

      if (buffers.length === 0) {
        return api.sendMessage("Failed to generate any images. Please try again later.", threadID, messageID);
      }

      if (num === 1 || buffers.length === 1) {
        const outPath = path.join(imagesDir, `${Date.now()}.png`);
        fs.writeFileSync(outPath, buffers[0]);
        return api.sendMessage(
          { attachment: fs.createReadStream(outPath) },
          threadID,
          () => setTimeout(() => { try { fs.unlinkSync(outPath); } catch {} }, 20 * 60 * 1000),
          messageID
        );
      } else {
        const cw = Math.round(W / 2);
        const ch = Math.round(H / 2);
        const metas = await Promise.all(buffers.map(b => sharp(b).metadata()));
        const processed = await Promise.all(buffers.map((b, i) => this.process(b, metas[i], cw, ch)));
        const gridBuffer = await this.grid(processed, cw * 2, ch * 2, cw, ch);
        const outPath = path.join(imagesDir, `${Date.now()}.png`);
        fs.writeFileSync(outPath, gridBuffer);

        return api.sendMessage(
          { body: ``, attachment: fs.createReadStream(outPath) },
          threadID,
          (err, info) => {
            if (err) return;
            setTimeout(() => { try { fs.unlinkSync(outPath); } catch {} }, 20 * 60 * 1000);
            commandHandler.setReplyHandler(info.messageID, senderID, {
              commandName: this.config.name,
              handler: this.handleReply.bind(this),
              data: { buffers }
            });
          },
          messageID
        );
      }
    } catch (e) {
      console.error(e);
    }
  }
};
