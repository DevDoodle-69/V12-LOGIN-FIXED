const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_KEY = "fgsiapi-37f137bd-6d";

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
    name: "mureka",
    aliases: [],
    version: "1.0",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Generate AI music with Mureka" },
    longDescription: { en: "Create AI-generated music with lyrics using Mureka AI" },
    category: "MUSIC",
    guide: { en: "mureka Lyrics | Prompt text" }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;

    if (!args.length) {
      return api.sendMessage(
        "Usage: mureka Lyrics | Prompt text",
        threadID,
        messageID
      );
    }

    const inputString = args.join(" ");

    if (!inputString.includes("|")) {
      return api.sendMessage(
        "Usage: mureka Lyrics | Prompt text",
        threadID,
        messageID
      );
    }

    const parts = inputString.split("|").map(p => p.trim());
    const lyrics = parts[0] || "";
    const prompt = parts.slice(1).join("|").trim();

    if (!lyrics || !prompt) {
      return api.sendMessage(
        "Lyrics and Prompt text both required.\nUsage: mureka Lyrics | Prompt text",
        threadID,
        messageID
      );
    }

    if (lyrics.length > 1000) {
      return api.sendMessage("Lyrics too long (max 1000 chars).", threadID, messageID);
    }

    if (prompt.length > 1000) {
      return api.sendMessage("Prompt text too long (max 1000 chars).", threadID, messageID);
    }

    const waiting = await api.sendMessage("Generating music...", threadID, messageID);

    try {
      const apiUrl = `https://fgsi.dpdns.org/api/ai/music/mureka?apikey=${API_KEY}&lyrics=${encodeURIComponent(lyrics)}&prompt=${encodeURIComponent(prompt)}`;

      const initialRes = await axios.get(apiUrl);
      const taskId = initialRes.data?.data?.taskId;
      const pollUrl = initialRes.data?.data?.pollUrl;

      if (!taskId || !pollUrl) {
        return api.editMessage("Task creation failed.", waiting.messageID, threadID);
      }

      await api.editMessage(`Task started: ${taskId}`, waiting.messageID, threadID);

      let taskData = null;
      let attempts = 0;
      const maxAttempts = 120;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;

        try {
          const { data } = await axios.get(pollUrl, { timeout: 30000 });

          if (data?.data?.status === "Success") {
            taskData = data;
            break;
          }

          if (data?.data?.status === "Failed") {
            return api.editMessage(
              "Generation failed on server.",
              waiting.messageID,
              threadID
            );
          }
        } catch (e) {
          if (e.response?.status !== 524) console.error(e);
        }

        if (attempts % 12 === 0) {
          await api.editMessage(
            `Still generating... (${Math.round((attempts * 5) / 60)} min)`,
            waiting.messageID,
            threadID
          );
        }
      }

      if (!taskData) {
        return api.editMessage(
          "Timed out after 10 minutes.",
          waiting.messageID,
          threadID
        );
      }

      await api.unsendMessage(waiting.messageID);

      const choices = taskData.data?.result?.choices;

      if (!choices || !choices.length) {
        return api.sendMessage("No songs generated.", threadID, messageID);
      }

      for (let i = 0; i < choices.length; i++) {
        const song = choices[i];
        const audioUrl = song.url;

        if (!audioUrl) continue;

        const tempDir = path.join(__dirname, "../../temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const audioPath = path.join(tempDir, `mureka_${Date.now()}_${i}.mp3`);

        try {
          await downloadFile(audioUrl, audioPath);
          await api.sendMessage({
            attachment: fs.createReadStream(audioPath)
          }, threadID, messageID);

          fs.unlinkSync(audioPath);

          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          console.error("Error downloading song:", error);
        }
      }

    } catch (error) {
      const msg = error.response?.data?.message || error.message || "Unknown error";
      api.editMessage(`Error: ${msg}`, waiting?.messageID || messageID, threadID);
    }
  }
};