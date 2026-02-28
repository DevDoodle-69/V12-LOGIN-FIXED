const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

module.exports = {
  config: {
    name: "nbpro2",
    aliases: [],
    version: "1.3",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Nano Banana Pro 2 AI images" },
    longDescription: { en: "Generate nano-banana-pro images" },
    category: "AI",
    guide: { en: "{prefix}nbpro <prompt> --ar 1:1|16:9|9:16 --num 1-4" }
  },

  ratioToSize(r) {
    if (r === "16:9") return [1792, 1024];
    if (r === "9:16") return [1024, 1792];
    return [1024, 1024];
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

  async poll(taskUrl, bearer) {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const r = await axios.get(taskUrl, {
        headers: { Authorization: `Bearer ${bearer}` },
        timeout: 20000
      });
      if (r.data.status === "done" && r.data.image_urls?.length) {
        return r.data.image_urls[0];
      }
      if (r.data.status === "failed") throw new Error("failed");
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error("timeout");
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
    const { buffers, suggestionMsgID } = data;

    const index = parseInt(event.body) - 1;
    if (isNaN(index) || index < 0 || index >= buffers.length) {
      return api.sendMessage("Invalid selection.", threadID, messageID);
    }

    if (suggestionMsgID) {
      // UnsendMessage removed to keep combined image available
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
    let ratio = "1:1";
    let num = 1;

    const ar = text.match(/--ar\s*(1:1|16:9|9:16)/i);
    if (ar) {
      ratio = ar[1];
      text = text.replace(ar[0], "").trim();
    }

    const nm = text.match(/--num\s*([1-4])/i);
    if (nm) {
      num = parseInt(nm[1]);
      text = text.replace(nm[0], "").trim();
    }

    if (!text) return;

    const [W, H] = this.ratioToSize(ratio);
    const imagesDir = path.join(__dirname, "images");
    await this.autoCleanup(imagesDir);

    const BEARER = "sk-paxsenix-Wb6nXF-6jiNjPjMJYFbawnfbED0_xY_baG0wyLTERmPLGU7H";
    const endpoint = "https://api.paxsenix.org/ai-image/nano-banana-2";

    const buffers = [];
    const files = [];

    try {
      for (let i = 0; i < num; i++) {
        const r = await axios.get(endpoint, {
          params: { prompt: text, model: "nano-banana-pro", ratio },
          headers: { Authorization: `Bearer ${BEARER}` },
          timeout: 60000
        });

        const imgUrl = await this.poll(r.data.task_url, BEARER);
        const img = await axios.get(imgUrl, { responseType: "arraybuffer" });
        buffers.push(Buffer.from(img.data));
      }

      let output;

      if (num === 1) {
        output = buffers[0];
        const outPath = path.join(imagesDir, `${Date.now()}.png`);
        fs.writeFileSync(outPath, output);
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
        output = await this.grid(processed, cw * 2, ch * 2, cw, ch);
        
        const outPath = path.join(imagesDir, `${Date.now()}.png`);
        fs.writeFileSync(outPath, output);
        
        return api.sendMessage(
          { body: "", attachment: fs.createReadStream(outPath) },
          threadID,
          (err, info) => {
            if (err) return;
            setTimeout(() => { try { fs.unlinkSync(outPath); } catch {} }, 20 * 60 * 1000);
            commandHandler.setReplyHandler(info.messageID, senderID, {
              commandName: this.config.name,
              handler: this.handleReply.bind(this),
              data: { buffers, suggestionMsgID: info.messageID }
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