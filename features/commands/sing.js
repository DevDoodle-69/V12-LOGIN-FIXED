const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const yts = require("yt-search");

const API_URL = "https://fgsi.dpdns.org/api/downloader/youtube/v2";
const API_KEY = "fgsiapi-2affc76f-6d";
const SHAZAM_API = "https://api.paxsenix.org/tools/shazam";
const SHAZAM_AUTH = "Bearer sk-paxsenix-Tjc1kgE9keNVFcoHEhINEQZcl9EnzyXNg8oe72834wIbaMOX";
const TEMP_DIR = path.join(__dirname, "../../temp_sing");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1"
];

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

module.exports = {
  config: {
    name: "sing",
    aliases: ["song"],
    version: "4.0",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Search and download audio" },
    longDescription: { en: "Search and download audio files from YouTube or recognize music from attachments." },
    category: "MUSIC",
    guide: { en: "{prefix}sing [query] or reply to audio/video" }
  },

  async onStart({ api, event, args, commandHandler }) {
    const { threadID, messageID, messageReply } = event;

    const searchYoutube = async (query) => {
      const searchResults = await yts(query);
      const videos = searchResults.videos.slice(0, 6);
      if (!videos.length) return [];
      return videos.map(v => ({
        title: v.title,
        artist: v.author.name,
        duration: v.timestamp,
        views: v.views,
        thumbnail: v.thumbnail,
        url: v.url
      }));
    };

    if (messageReply && messageReply.attachments?.length > 0) {
      const attachment = messageReply.attachments[0];
      if (attachment.type !== "audio" && attachment.type !== "video") {
        return api.sendMessage("Please reply to an audio or video file.", threadID, messageID);
      }

      const waiting = await api.sendMessage("Recognizing music...", threadID, messageID);
      try {
        const res = await axios.get(`${SHAZAM_API}?url=${encodeURIComponent(attachment.url)}`, {
          headers: {
            "Authorization": SHAZAM_AUTH,
            "Content-Type": "application/json"
          }
        });

        await api.unsendMessage(waiting.messageID);

        if (!res.data.ok || !res.data.track) {
          return api.sendMessage("Couldn't recognize the song.", threadID, messageID);
        }

        const songTitle = res.data.track.title;
        const artist = res.data.track.artist;
        const results = await searchYoutube(`${songTitle} ${artist}`);

        if (results.length === 0) {
          return api.sendMessage(`Recognized as "${songTitle}" but couldn't find it on YouTube.`, threadID, messageID);
        }

        return await handleSearchResults(this, api, event, results, commandHandler);
      } catch (err) {
        if (waiting.messageID) await api.unsendMessage(waiting.messageID);
        return api.sendMessage(`Recognition Error: ${err.message}`, threadID, messageID);
      }
    }

    if (!args[0]) {
      return api.sendMessage("Enter a song name or reply to an audio/video to search.", threadID, messageID);
    }

    const query = args.join(" ");
    try {
      const results = await searchYoutube(query);
      if (results.length === 0) {
        return api.sendMessage("No results found.", threadID, messageID);
      }
      return await handleSearchResults(this, api, event, results, commandHandler);
    } catch (err) {
      return api.sendMessage(`Error: ${err.message}`, threadID, messageID);
    }
  },

  async handleReply(context) {
    const { api, event, data } = context;
    const { threadID, messageID } = event;
    const { results, expired, timeout, suggestionMsgID } = data;

    if (expired) {
      return api.sendMessage("Request expired.", threadID, messageID);
    }

    const index = parseInt(event.body) - 1;
    if (isNaN(index) || index < 0 || index >= results.length) {
      return api.sendMessage("Invalid selection.", threadID, messageID);
    }

    if (timeout) clearTimeout(timeout);
    if (suggestionMsgID) {
      try { api.unsendMessage(suggestionMsgID); } catch { }
    }

    const track = results[index];
    const downloading = await api.sendMessage(`Downloading: ${track.title}...`, threadID, messageID);

    try {
      const apiUrl = `${API_URL}?apikey=${API_KEY}&url=${encodeURIComponent(track.url)}&type=mp3`;
      const { data: response } = await axios.get(apiUrl, {
        headers: { "User-Agent": getRandomUA() }
      });

      if (!response.status || !response.data || !response.data.url) {
        throw new Error("Invalid API response format");
      }

      const stream = await axios({
        url: response.data.url,
        method: "GET",
        responseType: "stream",
        headers: { 
          "User-Agent": getRandomUA(),
          "Referer": "https://www.youtube.com/"
        },
        timeout: 60000
      }).then(res => res.data);

      await api.unsendMessage(downloading.messageID);

      return api.sendMessage(
        {
          body: `Title: ${track.title}\nChannel: ${track.artist}\nDuration: ${track.duration}\nViews: ${track.views}`,
          attachment: stream
        },
        threadID,
        (err) => {
          if (err) api.sendMessage("Error sending audio file.", threadID, messageID);
        },
        messageID
      );

    } catch (error) {
      if (downloading.messageID) await api.unsendMessage(downloading.messageID);
      return api.sendMessage(`Download failed: ${error.message}`, threadID, messageID);
    }
  }
};

async function handleSearchResults(self, api, event, results, commandHandler) {
  const { threadID, messageID, senderID } = event;

  let msg = "Select a song:\n\n";
  results.forEach((v, i) => {
    msg += `${i + 1}. ${v.title}\nChannel: ${v.artist}\nDuration: ${v.duration}\n\n`;
  });

  try {
    const image = await createCombinedThumbnail(results);
    const stream = fs.createReadStream(image);

    return api.sendMessage(
      { body: msg + "Reply with a number within 30 seconds.", attachment: stream },
      threadID,
      (err, info) => {
        if (fs.existsSync(image)) fs.unlinkSync(image);
        if (err) return;

        const timeout = setTimeout(() => {
          api.editMessage("Request expired.", info.messageID, threadID);
          commandHandler.setReplyHandler(info.messageID, senderID, {
            commandName: self.config.name,
            handler: self.handleReply.bind(self),
            data: { expired: true }
          });
        }, 30000);

        commandHandler.setReplyHandler(info.messageID, senderID, {
          commandName: self.config.name,
          handler: self.handleReply.bind(self),
          data: { results, suggestionMsgID: info.messageID, expired: false, timeout }
        });
      },
      messageID
    );
  } catch (err) {
    return api.sendMessage(msg + "Reply with a number within 30 seconds.", threadID, (err, info) => {
       commandHandler.setReplyHandler(info.messageID, senderID, {
            commandName: self.config.name,
            handler: self.handleReply.bind(self),
            data: { results, suggestionMsgID: info.messageID, expired: false }
        });
    }, messageID);
  }
}

async function createCombinedThumbnail(tracks) {
  const W = 1920;
  const H = 1080;
  const cellW = 640;
  const cellH = 540;

  const buffers = await Promise.all(
    tracks.map(v =>
      v.thumbnail
        ? axios.get(v.thumbnail, { responseType: "arraybuffer" }).then(r => r.data).catch(() => null)
        : null
    )
  );

  const layers = [];
  for (let i = 0; i < 6; i++) {
    const buf = buffers[i];
    const img = buf
      ? await sharp(buf).resize(cellW, cellH, { fit: "cover" }).toBuffer()
      : await sharp({ create: { width: cellW, height: cellH, channels: 3, background: "#111" } }).png().toBuffer();

    layers.push({
      input: img,
      left: (i % 3) * cellW,
      top: Math.floor(i / 3) * cellH
    });
  }

  const out = await sharp({
    create: { width: W, height: H, channels: 3, background: "#000" }
  }).composite(layers).png().toBuffer();

  const file = path.join(TEMP_DIR, `yt_${Date.now()}.png`);
  fs.writeFileSync(file, out);
  return file;
}
