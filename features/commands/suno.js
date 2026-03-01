const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_KEY = "sk-paxsenix-Wb6nXF-6jiNjPjMJYFbawnfbED0_xY_baG0wyLTERmPLGU7H";
const SUNO_API = "https://api.paxsenix.org/ai-music/suno-music/v3";

const MODELS = ["V3", "V3_5", "V4", "V4_5", "V4_5PLUS", "V5"];
const RANDOM_MODEL = () => MODELS[Math.floor(Math.random() * MODELS.length)];

async function downloadFile(url, dest) {
  const writer = fs.createWriteStream(dest);
  const response = await axios({
    method: "get",
    url,
    responseType: "stream",
    timeout: 300000
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });
}

module.exports = {
  config: {
    name: "suno",
    aliases: [],
    version: "1.4",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Generate AI music with Suno" },
    longDescription: { en: "Create custom AI-generated music with lyrics using Suno AI" },
    category: "MUSIC",
    guide: {
      en:
        "{prefix}suno Title | Style | Lyrics [--model]\n" +
        "{prefix}suno AI <prompt> [--model]\nAvailable models: --V3 --V3_5 --V4 --V4_5 --V4_5PLUS --V5\nRandom model if not specified."
    }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;

    if (!args.length) {
      return api.sendMessage(
        "Usage:\n• suno Title | Style | Lyrics [--model]\n• suno AI <prompt> [--model]\nAvailable models: --V3 --V3_5 --V4 --V4_5 --V4_5PLUS --V5\nRandom model if not specified.",
        threadID,
        messageID
      );
    }

    let model = RANDOM_MODEL();
    let cleanArgs = [...args];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i].toUpperCase();
      if (arg.startsWith("--V") && MODELS.includes(arg.slice(2))) {
        model = arg.slice(2);
        cleanArgs.splice(i, 1);
        break;
      }
    }

    const subCommand = cleanArgs[0]?.toLowerCase();
    let payload = { model, customMode: true, instrumental: false, title: "", style: "", prompt: "" };

    if (subCommand === "ai") {
      const prompt = cleanArgs.slice(1).join(" ").trim();
      if (!prompt) return api.sendMessage("Usage: suno AI <prompt> [--model]", threadID, messageID);
      payload = { model, customMode: false, instrumental: false, title: "", style: "", prompt };
    } else {
      const inputString = cleanArgs.join(" ");
      if (!inputString.includes("|")) return api.sendMessage("Usage: suno Title | Style | Lyrics [--model]", threadID, messageID);

      const parts = inputString.split("|").map(p => p.trim());
      const title = parts[0] || "";
      const style = parts[1] || "";
      const prompt = parts.slice(2).join("|").trim();

      if (!title || !style || !prompt) return api.sendMessage("Title, Style and Lyrics required.", threadID, messageID);

      payload = { model, customMode: true, instrumental: false, title, style, prompt };
    }

    try {
      const res = await axios.post(SUNO_API, payload, {
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        timeout: 60000
      });

      if (!res.data.ok || !res.data.jobId || !res.data.task_url) {
        return api.sendMessage("API rejected request.", threadID, messageID);
      }

      const { jobId, task_url: taskUrl } = res.data;
      const waiting = await api.sendMessage(`Generating... Job ID: ${jobId}`, threadID, messageID);

      let taskData = null;
      let attempts = 0;

      while (attempts < 120) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;

        try {
          const { data } = await axios.get(taskUrl, { timeout: 30000 });
          if (data.ok && data.status === "done" && data.records?.length) {
            taskData = data;
            break;
          }
          if (data.ok && data.status === "failed") {
            return api.sendMessage("Generation failed on server.", threadID, messageID);
          }
        } catch (e) {
          if (e.response?.status !== 524) console.error(e);
        }
      }

      if (!taskData) {
        return api.sendMessage("Timed out or server error.", threadID, messageID);
      }

      await api.unsendMessage(waiting.messageID);

      for (let i = 0; i < taskData.records.length; i++) {
        const rec = taskData.records[i];
        const audioPath = path.join(__dirname, `suno_${jobId}_${i}.mp3`);
        const imagePath = path.join(__dirname, `suno_${jobId}_${i}.jpg`);

        await downloadFile(rec.audio_url, audioPath);
        await api.sendMessage({ attachment: fs.createReadStream(audioPath) }, threadID, messageID);
        fs.unlinkSync(audioPath);

        if (rec.image_url) {
          await downloadFile(rec.image_url, imagePath);
          await api.sendMessage({ attachment: fs.createReadStream(imagePath) }, threadID, messageID);
          fs.unlinkSync(imagePath);
        }

        await api.sendMessage(`Song ID : ${rec.id}\nhttps://suno.com/song/${rec.id}`, threadID, messageID);
      }
    } catch (error) {
      api.sendMessage(`Error: ${error.message}`, threadID, messageID);
    }
  }
};
