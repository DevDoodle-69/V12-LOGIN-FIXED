module.exports = {
  config: {
    name: "profile",
    aliases: ["pfp", "avatar"],
    version: "1.1",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: {
      en: "Get Facebook Profile Picture"
    },
    longDescription: {
      en: "Get high-quality Facebook profile picture from mention, reply, profile link or yourself"
    },
    category: "UTILITY",
    guide: {
      en: "{prefix}profile - Get your own profile picture\n{prefix}profile @mention - Get mentioned user's profile picture\n{prefix}profile <profile link> - Get profile picture from profile link\nReply to someone's message with {prefix}profile"
    }
  },
  onStart: async function({
    api,
    event,
    args
  }) {
    try {
      let uid;
      let attachment = [];
      if (event.type === "message_reply") {
        uid = event.messageReply.senderID;
      } else if (Object.keys(event.mentions).length > 0) {
        uid = Object.keys(event.mentions)[0];
      } else if (args[0]?.match(/facebook.com|fb.com/)) {
        const fblink = args[0];
        try {
          uid = await api.resolvePhotoUrl(fblink);
        } catch {
          return api.sendMessage("❌ Invalid Facebook profile link", event.threadID, event.messageID);
        }
      } else {
        uid = event.senderID;
      }
      const profileUrl = `https://graph.facebook.com/${uid}/picture?width=1500&height=1500&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`;
      const axios = require('axios');
      const response = await axios.get(profileUrl, {
        responseType: 'stream'
      });
      attachment = [response.data];
      return api.sendMessage({
        attachment: attachment
      }, event.threadID, event.messageID);
    } catch (error) {
      console.error(error);
      return api.sendMessage("❌ An error occurred while fetching the profile picture.", event.threadID, event.messageID);
    }
  }
};