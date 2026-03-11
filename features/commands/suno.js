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
    version: "1.5",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Generate AI music with Suno" },
    longDescription: { en: "Create custom AI-generated music with lyrics using Suno AI" },
    category: "MUSIC",
    guide: {
      en:
        "{prefix}suno Title | Style | Lyrics [--V3|--V3_5|--V4|--V4_5|--V4_5PLUS|--V5]\n" +
        "{prefix}suno AI <prompt> [--V3|--V3_5|--V4|--V4_5|--V4_5PLUS|--V5]"
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

    let payload = {
      model,
      customMode: true,
      instrumental: false,
      title: "",
      style: "",
      prompt: ""
    };

    if (subCommand === "ai") {
      const prompt = cleanArgs.slice(1).join(" ").trim();
      if (!prompt)
        return api.sendMessage("Usage: suno AI <prompt> [--model]", threadID, messageID);
      if (prompt.length > 400)
        return api.sendMessage("Prompt too long (max 400 chars).", threadID, messageID);

      payload = {
        model,
        customMode: false,
        instrumental: false,
        title: "",
        style: "",
        prompt
      };
    } else {
      const inputString = cleanArgs.join(" ");
      if (!inputString.includes("|"))
        return api.sendMessage(
          "Usage: suno Title | Style | Lyrics [--model]",
          threadID,
          messageID
        );

      const parts = inputString.split("|").map(p => p.trim());
      const title = parts[0] || "";
      const style = parts[1] || "";
      const prompt = parts.slice(2).join("|").trim();

      if (!title || !style || !prompt)
        return api.sendMessage(
          "Title, Style and Lyrics required.\nUsage: suno Title | Style | Lyrics [--model]",
          threadID,
          messageID
        );

      if (title.length > 80)
        return api.sendMessage("Title too long (max 80 chars).", threadID, messageID);

      const styleLimit = ["V4_5", "V4_5PLUS", "V5"].includes(model) ? 1000 : 200;
      if (style.length > styleLimit)
        return api.sendMessage(
          `Style too long for ${model} (max ${styleLimit} chars).`,
          threadID,
          messageID
        );

      const promptLimit = ["V4_5", "V4_5PLUS", "V5"].includes(model) ? 5000 : 3000;
      if (prompt.length > promptLimit)
        return api.sendMessage(
          `Lyrics too long for ${model} (max ${promptLimit} chars).`,
          threadID,
          messageID
        );

      payload = {
        model,
        customMode: true,
        instrumental: false,
        title,
        style,
        prompt
      };
    }

    let waiting;

    try {
      const res = await axios.post(SUNO_API, payload, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      });

      let taskData = null;

      // Check if response already contains the completed records
      if (res.data.ok && res.data.status === "done" && res.data.records?.length) {
        taskData = res.data;
      } else if (res.data.ok && (res.data.jobId || res.data.task_url)) {
        // Handle polling if jobId and task_url are provided
        const taskUrl = res.data.task_url;
        const jobId = res.data.jobId;

        waiting = await api.sendMessage(`Generating... Job ID: ${jobId}`, threadID, messageID);

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

        if (waiting && waiting.messageID) {
          try {
            await api.unsendMessage(waiting.messageID);
          } catch (e) {
            console.error("Error removing waiting message:", e);
          }
        }

        if (!taskData) {
          return api.sendMessage("Timed out after 10 minutes or server error (524). Try again later.", threadID, messageID);
        }
      } else {
        return api.sendMessage("API rejected request. Invalid response format.", threadID, messageID);
      }

      // Process and send the records
      if (taskData && taskData.records && taskData.records.length > 0) {
        for (let i = 0; i < taskData.records.length; i++) {
          const rec = taskData.records[i];
          const songId = rec.id;
          const title = rec.title || "Untitled Song";
          const duration = rec.duration ? `${rec.duration}s` : "Unknown duration";

          // Send the song title and details
          await api.sendMessage(
            `🎵 ${title}\n⏱️ Duration: ${duration}\n🔗 https://suno.com/song/${songId}`,
            threadID,
            messageID
          );

          // Download and send audio
          if (rec.audio_url) {
            try {
              const audioPath = path.join(__dirname, `suno_${songId}_audio.mp3`);
              await downloadFile(rec.audio_url, audioPath);
              await api.sendMessage({ attachment: fs.createReadStream(audioPath) }, threadID, messageID);
              try {
                fs.unlinkSync(audioPath);
              } catch (e) {
                console.error("Error deleting audio file:", e);
              }
            } catch (e) {
              console.error("Error downloading/sending audio:", e);
              await api.sendMessage(`⚠️ Failed to download audio file for song ${songId}`, threadID, messageID);
            }
          }

          // Download and send image
          if (rec.image_url) {
            try {
              const imagePath = path.join(__dirname, `suno_${songId}_image.jpg`);
              await downloadFile(rec.image_url, imagePath);
              await api.sendMessage({ attachment: fs.createReadStream(imagePath) }, threadID, messageID);
              try {
                fs.unlinkSync(imagePath);
              } catch (e) {
                console.error("Error deleting image file:", e);
              }
            } catch (e) {
              console.error("Error downloading/sending image:", e);
              await api.sendMessage(`⚠️ Failed to download cover image for song ${songId}`, threadID, messageID);
            }
          }
        }
      } else {
        return api.sendMessage("No records found in response.", threadID, messageID);
      }
    } catch (error) {
      const msg = error.response?.data?.message || error.message || "Unknown error";
      api.sendMessage(`❌ Error: ${msg}`, threadID, messageID);
    }
  }
};
