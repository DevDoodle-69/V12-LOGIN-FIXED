const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://fgsi.dpdns.org";
const API_KEY = "fgsiapi-37f137bd-6d";

module.exports = {
  config: {
    name: "sora",
    aliases: ["sora2"],
    version: "2.2",
    author: "NZ R",
    countDown: 40,
    role: 0,
    shortDescription: { en: "Generate AI videos with Sora-2" },
    longDescription: { en: "Generate videos from text prompts using Sora-2 AI" },
    category: "ai",
    guide: { en: "{prefix}sora <prompt> --ar <16:9|9:16> --enhanceprompt <true|false>" }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;

    if (!args.length) {
      return api.sendMessage(
        "Usage: sora <prompt> --ar <16:9|9:16> --enhanceprompt <true|false>",
        threadID,
        messageID
      );
    }

    let ratio = "landscape";
    let enhancePrompt = "true";
    
    const arIndex = args.indexOf("--ar");
    if (arIndex !== -1 && args[arIndex + 1]) {
      const arValue = args[arIndex + 1];
      if (arValue === "16:9") ratio = "landscape";
      else if (arValue === "9:16") ratio = "portrait";
      args.splice(arIndex, 2);
    }

    const epIndex = args.indexOf("--enhanceprompt");
    if (epIndex !== -1 && args[epIndex + 1]) {
      enhancePrompt = args[epIndex + 1].toLowerCase() === "false" ? "false" : "true";
      args.splice(epIndex, 2);
    }

    const promptText = args.join(" ").trim();
    if (!promptText) {
      return api.sendMessage("No prompt provided", threadID, messageID);
    }

    const tempDir = path.join(__dirname, "../../temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const waiting = await api.sendMessage(
      "Generating video please wait",
      threadID,
      messageID
    );

    try {
      const createRes = await axios.get(`${API_BASE}/api/ai/sora2`, {
        params: {
          apikey: API_KEY,
          prompt: `${promptText}&ratio=${ratio}&enhancePrompt=${enhancePrompt}`
        }
      });

      if (!createRes.data.status) {
        return api.editMessage(`Error: ${createRes.data.message || "Failed to create task"}`, waiting.messageID, threadID);
      }

      const { taskId, pollUrl } = createRes.data.data;
      await api.editMessage(`Task created ID: ${taskId} processing`, waiting.messageID, threadID);

      let resultVideo = null;
      let attempts = 0;
      const maxAttempts = 72;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        const pollRes = await axios.get(pollUrl);
        
        if (pollRes.data.status && pollRes.data.data.status === "Success") {
          resultVideo = pollRes.data.data.result.resultUrls[0];
          break;
        } else if (pollRes.data.data.status === "Failed") {
          throw new Error("Video generation failed");
        }
        attempts++;
      }

      if (!resultVideo) {
        throw new Error("Polling timed out");
      }

      await api.editMessage("Downloading video", waiting.messageID, threadID);

      const videoPath = path.join(tempDir, `sora2_${Date.now()}.mp4`);
      const writer = fs.createWriteStream(videoPath);
      const response = await axios.get(resultVideo, { responseType: "stream" });
      
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      await api.unsendMessage(waiting.messageID);

      await api.sendMessage({
        attachment: fs.createReadStream(videoPath)
      }, threadID, (err) => {
        if (err) console.error(err);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      }, messageID);

    } catch (error) {
      console.error(error);
      api.editMessage(`Error: ${error.message}`, waiting.messageID, threadID);
    }
  }
};