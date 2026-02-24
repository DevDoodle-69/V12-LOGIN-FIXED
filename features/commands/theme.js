const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports = {
  config: {
    name: "theme",
    aliases: ["ai-theme"],
    version: "1.0.0",
    author: "NZ R",
    countDown: 10,
    role: 0,
    shortDescription: { en: "Create custom AI themes" },
    longDescription: { en: "Create custom AI-generated themes for your Messenger thread using a text prompt." },
    category: "UTILITY",
    guide: { en: "{prefix}theme <prompt>" }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;
    const prompt = args.join(" ").trim();

    if (!prompt) {
      return api.sendMessage("Please provide a prompt to generate the theme. Example: theme cyber-neon blue", threadID, messageID);
    }

    const waiting = await api.sendMessage("Generating your custom AI theme... Please wait.", threadID, messageID);

    try {
      // Use the generateTheme function from the FCA library
      api.generateTheme(prompt, threadID, async (err, themeData) => {
        if (err) {
          return api.editMessage(`Failed to generate theme: ${err.message || err}`, waiting.messageID, threadID);
        }

        const backgroundUrl = themeData.background_asset?.image?.uri || themeData.image_url;
        
        if (!backgroundUrl) {
            return api.editMessage("Theme generated but couldn't retrieve the image URL.", waiting.messageID, threadID);
        }

        try {
          const imgRes = await axios.get(backgroundUrl, { responseType: "arraybuffer" });
          const filePath = path.join(__dirname, `theme_${Date.now()}.png`);
          fs.writeFileSync(filePath, Buffer.from(imgRes.data));

          await api.sendMessage(
            {
              body: `✅ AI Theme Generated!\nPrompt: ${prompt}\nTheme ID: ${themeData.id}`,
              attachment: fs.createReadStream(filePath)
            },
            threadID,
            () => {
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            },
            messageID
          );
          
          await api.unsendMessage(waiting.messageID);
        } catch (downloadErr) {
          api.editMessage(`Theme generated (ID: ${themeData.id}) but failed to download image preview.`, waiting.messageID, threadID);
        }
      });
    } catch (error) {
      api.editMessage(`An error occurred: ${error.message}`, waiting.messageID, threadID);
    }
  }
};
