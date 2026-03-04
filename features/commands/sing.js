const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const yts = require("yt-search");

const DOWNLOAD_API = "https://fgsi.dpdns.org/api/downloader/youtube/v2";
const DOWNLOAD_KEY = "fgsiapi-2affc76f-6d";
const RECOGNIZE_API = "https://api.paxsenix.org/tools/shazam";
const RECOGNIZE_AUTH = "Bearer sk-paxsenix-Tjc1kgE9keNVFcoHEhINEQZcl9EnzyXNg8oe72834wIbaMOX";
const TEMP_DIR = path.join(__dirname, "../../temp_sing");

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

module.exports = {
    config: {
        name: "sing",
        aliases: ["song"],
        version: "4.1",
        author: "NZ R",
        countDown: 5,
        role: 0,
        category: "MUSIC",
        guide: { en: "{prefix}sing [query/reply to audio or video]" }
    },

    async onStart({ api, event, args, commandHandler }) {
        const { threadID, messageID, type, messageReply } = event;

        if (type === "message_reply" && messageReply.attachments && messageReply.attachments.length > 0) {
            const attachment = messageReply.attachments[0];
            if (attachment.type === "audio" || attachment.type === "video") {
                try {
                    const recRes = await axios.get(`${RECOGNIZE_API}?url=${encodeURIComponent(attachment.url)}`, {
                        headers: { "Authorization": RECOGNIZE_AUTH }
                    });
                    if (recRes.data.ok && recRes.data.track) {
                        const query = `${recRes.data.track.title} ${recRes.data.track.artist}`;
                        return this.searchAndSend(api, event, query, commandHandler);
                    }
                } catch (e) {
                    return api.sendMessage("Could not recognize song from attachment.", threadID, messageID);
                }
            }
        }

        if (!args[0]) return api.sendMessage("Enter a song name or reply to an audio/video.", threadID, messageID);
        return this.searchAndSend(api, event, args.join(" "), commandHandler);
    },

    async searchAndSend(api, event, query, commandHandler) {
        const { threadID, messageID, senderID } = event;
        try {
            const search = await yts(query);
            const videos = search.videos.slice(0, 6);
            if (!videos.length) return api.sendMessage("No results found.", threadID, messageID);

            const tracks = videos.map(v => ({
                title: v.title,
                artist: v.author.name,
                duration: v.timestamp,
                views: v.views,
                thumbnail: v.thumbnail,
                url: v.url
            }));

            let msg = "Select a song:\n\n";
            tracks.forEach((v, i) => {
                msg += `${i + 1}. ${v.title}\nChannel: ${v.artist}\nDuration: ${v.duration}\n\n`;
            });

            const image = await createCombinedThumbnail(tracks);
            return api.sendMessage({ body: msg + "Reply with a number.", attachment: fs.createReadStream(image) }, threadID, (err, info) => {
                if (fs.existsSync(image)) fs.unlinkSync(image);
                if (err) return;

                commandHandler.setReplyHandler(info.messageID, senderID, {
                    commandName: this.config.name,
                    handler: this.handleReply.bind(this),
                    data: { results: tracks, suggestionMsgID: info.messageID }
                });
            }, messageID);
        } catch (e) {
            return api.sendMessage("Search failed.", threadID, messageID);
        }
    },

    async handleReply(context) {
        const { api, event, data } = context;
        const { threadID, messageID, body } = event;
        const index = parseInt(body) - 1;

        if (isNaN(index) || index < 0 || index >= data.results.length) return;
        if (data.suggestionMsgID) {
            try { api.unsendMessage(data.suggestionMsgID); } catch (e) {}
        }

        const track = data.results[index];
        try {
            const apiUrl = `${DOWNLOAD_API}?apikey=${DOWNLOAD_KEY}&url=${encodeURIComponent(track.url)}&type=mp3`;
            const { data: response } = await axios.get(apiUrl, { headers: { "User-Agent": UA } });

            if (!response.status || !response.data || !response.data.url) {
                return api.sendMessage("Failed to get download link from API.", threadID, messageID);
            }

            const stream = await axios({
                url: response.data.url,
                method: "GET",
                responseType: "stream",
                headers: { "User-Agent": UA, "Referer": "https://www.youtube.com/" }
            }).then(res => res.data);

            return api.sendMessage({
                body: `Title: ${track.title}\nChannel: ${track.artist}\nDuration: ${track.duration}`,
                attachment: stream
            }, threadID, messageID);
        } catch (error) {
            return api.sendMessage("Error downloading the audio file.", threadID, messageID);
        }
    }
};

async function createCombinedThumbnail(tracks) {
    const W = 1920, H = 1080, cellW = 640, cellH = 540;
    const buffers = await Promise.all(tracks.map(v => 
        axios.get(v.thumbnail, { responseType: "arraybuffer" })
            .then(r => r.data)
            .catch(() => null)
    ));

    const layers = [];
    for (let i = 0; i < 6; i++) {
        const buf = buffers[i];
        const img = buf 
            ? await sharp(buf).resize(cellW, cellH, { fit: "cover" }).toBuffer() 
            : await sharp({ create: { width: cellW, height: cellH, channels: 3, background: "#111" } }).png().toBuffer();

        layers.push({ input: img, left: (i % 3) * cellW, top: Math.floor(i / 3) * cellH });
    }

    const file = path.join(TEMP_DIR, `yt_${Date.now()}.png`);
    await sharp({ create: { width: W, height: H, channels: 3, background: "#000" } })
        .composite(layers)
        .png()
        .toFile(file);
    return file;
}
