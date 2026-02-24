module.exports = {
  config: {
    name: "userinfo",
    aliases: ["ui", "info", "whois"],
    version: "1.5",
    author: "Replit Agent",
    countDown: 5,
    role: 0,
    shortDescription: {
      en: "Get comprehensive user information"
    },
    longDescription: {
      en: "Get detailed information about a user including profile picture, cover photo, UID, gender, and more."
    },
    category: "UTILITY",
    guide: {
      en: "{prefix}userinfo - Get your own info\n{prefix}userinfo @mention - Get mentioned user's info\nReply to a message with {prefix}userinfo"
    }
  },

  onStart: async function({ api, event, args }) {
    const axios = require("axios");
    const fs = require("fs-extra");
    const path = require("path");

    let uid;
    if (event.type === "message_reply") {
      uid = event.messageReply.senderID;
    } else if (Object.keys(event.mentions).length > 0) {
      uid = Object.keys(event.mentions)[0];
    } else if (args[0] && !isNaN(args[0])) {
      uid = args[0];
    } else {
      uid = event.senderID;
    }

    try {
      api.sendMessage("🔍 Fetching user information, please wait...", event.threadID, event.messageID);

      // Get basic user info
      const userInfo = await api.getUserInfo(uid);
      const user = userInfo[uid];

      if (!user) {
        return api.sendMessage("❌ Could not find information for this user.", event.threadID, event.messageID);
      }

      // Get cover photo URL using a helper if available or construct it
      let coverUrl = "";
      try {
        // Attempt to get cover using graph API or internal method
        // Note: Graph API access for covers often requires specific tokens, but we'll try common patterns
        coverUrl = `https://graph.facebook.com/${uid}/?fields=cover&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`;
        const coverRes = await axios.get(coverUrl);
        coverUrl = coverRes.data.cover ? coverRes.data.cover.source : null;
      } catch (e) {
        coverUrl = null;
      }

      const profileUrl = `https://graph.facebook.com/${uid}/picture?width=1500&height=1500&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`;
      
      const name = user.name || "Unknown";
      const firstName = user.firstName || "N/A";
      const vanity = user.vanity || "None";
      const gender = user.gender === 2 ? "Male" : user.gender === 1 ? "Female" : "Unknown";
      const profileLink = user.profileUrl || `https://www.facebook.com/profile.php?id=${uid}`;
      const isFriend = user.isFriend ? "Yes" : "No";

      let msg = `👤 [ USER INFORMATION ] 👤\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📝 Name: ${name}\n`;
      msg += `🆔 UID: ${uid}\n`;
      msg += `👤 First Name: ${firstName}\n`;
      msg += `🔗 Username: ${vanity}\n`;
      msg += `⚧ Gender: ${gender}\n`;
      msg += `👫 Is Friend: ${isFriend}\n`;
      msg += `🌐 Profile Link: ${profileLink}\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `✨ This is a professional lookup command.`;

      const attachments = [];
      const cacheDir = path.join(__dirname, "cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

      // Download Profile Picture
      const pfpPath = path.join(cacheDir, `pfp_${uid}.png`);
      const pfpRes = await axios.get(profileUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(pfpPath, Buffer.from(pfpRes.data, "binary"));
      attachments.push(fs.createReadStream(pfpPath));

      // Download Cover Picture if available
      if (coverUrl) {
        const coverPath = path.join(cacheDir, `cover_${uid}.png`);
        const coverRes = await axios.get(coverUrl, { responseType: "arraybuffer" });
        fs.writeFileSync(coverPath, Buffer.from(coverRes.data, "binary"));
        attachments.push(fs.createReadStream(coverPath));
      }

      return api.sendMessage({
        body: msg,
        attachment: attachments
      }, event.threadID, () => {
        // Cleanup cache files after sending
        try {
          if (fs.existsSync(pfpPath)) fs.unlinkSync(pfpPath);
          const coverPath = path.join(cacheDir, `cover_${uid}.png`);
          if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
        } catch (e) {}
      }, event.messageID);

    } catch (error) {
      console.error(error);
      return api.sendMessage(`❌ Error: ${error.message}`, event.threadID, event.messageID);
    }
  }
};