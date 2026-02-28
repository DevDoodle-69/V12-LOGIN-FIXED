const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

module.exports = {
  config: {
    name: "alpha",
    aliases: [],
    version: "2.0",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Weird AI art. Go wild." },
    longDescription: { en: "Spits out 4 cursed pics. Pick 1. That's it." },
    category: "AI",
    guide: { en: "{prefix}img4 <prompt> --ar 16:9 | 1:1 | 9:16" }
  },

  async cleanupFiles(files) {
    for (const f of files) {
      try {
        if (fs.existsSync(f)) await fs.promises.unlink(f);
      } catch {}
    }
  },

  async autoCleanupFolder() {
    try {
      const dir = path.join(__dirname, "images");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      const now = Date.now();
      for (const f of fs.readdirSync(dir)) {
        const file = path.join(dir, f);
        if (now - fs.statSync(file).mtime.getTime() > 20 * 60 * 1000) {
          await fs.promises.unlink(file);
        }
      }
    } catch {}
  },

  async onStart({ api, event, args, commandHandler }) {
    const { threadID, messageID, senderID } = event;
    await this.autoCleanupFolder();

    if (!args.length) {
      return api.sendMessage("Bro give me something to imagine.", threadID, messageID);
    }

    let prompt = args.join(" ");
    let size = "1024x1024";

    const arMatch = prompt.match(/--ar\s*(16:9|1:1|9:16)/i);
    if (arMatch) {
      const ratio = arMatch[1];
      switch (ratio) {
        case "16:9":
          size = "1792x1024";
          break;
        case "9:16":
          size = "1024x1792";
          break;
        default:
          size = "1024x1024";
      }
      prompt = prompt.replace(arMatch[0], "").trim();
    }

    if (!prompt) {
      return api.sendMessage("You forgot the idea, nice.", threadID, messageID);
    }

    const imagesDir = path.join(__dirname, "images");
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

    const tempFiles = [];
    const imageBuffers = [];

    try {
      const res = await axios.post(
        "https://api.infip.pro/v1/images/generations",
        {
          model: "img4",
          n: 4,
          prompt,
          response_format: "url",
          size
        },
        {
          headers: {
            "Authorization": "Bearer infip-2b963118",
            "Content-Type": "application/json",
            "accept": "application/json"
          },
          timeout: 60000
        }
      );

      for (const img of res.data.data) {
        const imgRes = await axios.get(img.url, { responseType: "arraybuffer" });
        imageBuffers.push(Buffer.from(imgRes.data));
      }

      for (let i = 0; i < imageBuffers.length; i++) {
        const p = path.join(imagesDir, `img4_${i + 1}_${Date.now()}.png`);
        fs.writeFileSync(p, imageBuffers[i]);
        tempFiles.push(p);
      }

      const metas = await Promise.all(imageBuffers.map(b => sharp(b).metadata()));
      const [w, h] = size.split("x").map(Number);
      const cellW = Math.round(w / 2);
      const cellH = Math.round(h / 2);

      const processed = await Promise.all(
        imageBuffers.map((b, i) => {
          const m = metas[i];
          const r1 = cellW / cellH;
          const r2 = m.width / m.height;

          const crop = r2 > r1
            ? {
                width: Math.round(m.height * r1),
                height: m.height,
                left: Math.round((m.width - m.height * r1) / 2),
                top: 0
              }
            : {
                width: m.width,
                height: Math.round(m.width / r1),
                left: 0,
                top: Math.round((m.height - m.width / r1) / 2)
              };

          return sharp(b)
            .extract(crop)
            .resize(cellW, cellH)
            .png()
            .toBuffer();
        })
      );

      const grid = await sharp({
        create: {
          width: cellW * 2,
          height: cellH * 2,
          channels: 3,
          background: { r: 0, g: 0, b: 0 }
        }
      })
        .composite(processed.map((input, i) => ({
          input,
          left: (i % 2) * cellW,
          top: Math.floor(i / 2) * cellH
        })))
        .png()
        .toBuffer();

      const gridPath = path.join(imagesDir, `grid_${Date.now()}.png`);
      fs.writeFileSync(gridPath, grid);
      tempFiles.push(gridPath);

      await api.sendMessage(
        {
          body: "",
          attachment: fs.createReadStream(gridPath)
        },
        threadID,
        (e, info) => {
          if (e) return;
          commandHandler.setReplyHandler(info.messageID, senderID, {
            commandName: this.config.name,
            handler: this.handleReply.bind(this),
            data: {
              images: tempFiles.slice(0, 4),
              tempFiles
            },
            maxAttempts: 10,
            persistent: true
          });
          setTimeout(() => this.cleanupFiles(tempFiles), 20 * 60 * 1000);
        },
        messageID
      );
    } catch {
      setTimeout(() => this.cleanupFiles(tempFiles), 20 * 60 * 1000);
      api.sendMessage("broke. try again.", threadID, messageID);
    }
  },

  async handleReply({ api, event, data }) {
    const { threadID, messageID, body } = event;
    const i = parseInt(body?.trim());
    if (isNaN(i) || i < 1 || i > 4) {
      return api.sendMessage("1-4. Not hard.", threadID, messageID);
    }

    const file = data.images[i - 1];
    try {
      const out = await sharp(file).sharpen().png().toBuffer();
      const final = file.replace(".png", `_final.png`);
      fs.writeFileSync(final, out);
      data.tempFiles.push(final);

      await api.sendMessage(
        { attachment: fs.createReadStream(final) },
        threadID,
        () => setTimeout(() => this.cleanupFiles(data.tempFiles), 20 * 60 * 1000),
        messageID
      );
    } catch {
      api.sendMessage("Nah, failed.", threadID, messageID);
    }
  }
};