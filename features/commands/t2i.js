const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = {
  config: {
    name: "t2i",
    version: "1.0.0",
    author: "replit",
    countDown: 5,
    role: 0,
    category: "ai",
    description: "Text to image generation",
    usePrefix: true
  },

  onStart: async function ({ api, event, args, reply }) {
    const prompt = args.join(" ").split("--")[0].trim();
    if (!prompt) return reply("Please provide a prompt.");

    const options = {};
    args.join(" ").split("--").slice(1).forEach(opt => {
      const [key, ...val] = opt.trim().split(" ");
      options[key.toLowerCase()] = val.join(" ");
    });

    const ar = (options.ar || options.ratio || "1:1").toLowerCase();
    const provider = (options.provider || options.p || "koy").toLowerCase();
    const model = (options.model || options.m || "flux-2-dev").toLowerCase();
    const num = Math.min(Math.max(parseInt(options.num || options.n) || 1, 1), 4);

    const ratios = {
      "1:1": [1024, 1024],
      "4:5": [1080, 1350],
      "9:16": [1080, 1920],
      "16:9": [1920, 1080],
      "21:9": [2048, 858],
      "2k": [2048, 2048],
      "4k": [4096, 4096]
    };

    const [width, height] = ratios[ar] || [1024, 1024];

    try {
      const response = await axios.post('https://koy.xx.kg/_internal/generate', {
        prompt,
        model,
        width,
        height,
        seed: -1,
        provider,
        n: num
      }, { timeout: 120000 });

      const attachments = [];
      const cacheDir = path.join(__dirname, 'cache');
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

      const data = response.data;
      let images = [];
      
      if (Array.isArray(data.data)) {
        images = data.data.map(img => typeof img === 'string' ? img : img.url);
      } else if (data.url) {
        images = [data.url];
      } else if (response.headers['content-type']?.startsWith('image/')) {
        const imgPath = path.join(cacheDir, `t2i_${Date.now()}.png`);
        fs.writeFileSync(imgPath, Buffer.from(response.data));
        return await api.sendMessage({ attachment: fs.createReadStream(imgPath) }, event.threadID, () => {
          if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }, event.messageID);
      }

      for (let i = 0; i < images.length; i++) {
        const url = images[i];
        if (!url) continue;
        const imgPath = path.join(cacheDir, `t2i_${Date.now()}_${i}.png`);
        const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync(imgPath, Buffer.from(imgRes.data));
        attachments.push(fs.createReadStream(imgPath));
      }

      if (attachments.length > 0) {
        await api.sendMessage({ attachment: attachments }, event.threadID, (err) => {
          attachments.forEach(stream => {
            if (fs.existsSync(stream.path)) fs.unlinkSync(stream.path);
          });
        }, event.messageID);
      }
    } catch (error) {
      // Silent fail as requested for simple/professional use
    }
  }
};