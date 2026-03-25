const axios = require("axios");
const fs = require("fs").promises;
const fssync = require("fs");
const path = require("path");
const sharp = require("sharp");
const IMAGES_BASE_DIR = path.join(__dirname, "metaai_images");
const PANTRY_ID = "be100dcb-97a4-4490-a5fd-855590264879";
const STORAGE_BASKET = "metaai_conversations";
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}
async function loadStorage() {
  try {
    const { data } = await axios.get(`https://getpantry.cloud/apiv1/pantry/${PANTRY_ID}/basket/${STORAGE_BASKET}`);
    return data || {};
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return {};
    }
    console.error("Pantry load error:", err.message);
    return {};
  }
}
async function saveStorage(data) {
  try {
    await axios.put(`https://getpantry.cloud/apiv1/pantry/${PANTRY_ID}/basket/${STORAGE_BASKET}`, data);
  } catch (err) {
    console.error("Pantry save error:", err.message);
  }
}
function formatBoldText(text) {
  const map = {
    A: "𝗔", B: "𝗕", C: "𝗖", D: "𝗗", E: "𝗘", F: "𝗙", G: "𝗚", H: "𝗛", I: "𝗜", J: "𝗝", K: "𝗞", L: "𝗟", M: "𝗠", N: "𝗡", O: "𝗢", P: "𝗣", Q: "𝗤", R: "𝗥", S: "𝗦", T: "𝗧", U: "𝗨", V: "𝗩", W: "𝗪", X: "𝗫", Y: "𝗬", Z: "𝗭",
    a: "𝗮", b: "𝗯", c: "𝗰", d: "𝗱", e: "𝗲", f: "𝗳", g: "𝗴", h: "𝗵", i: "𝗶", j: "𝗷", k: "𝗸", l: "𝗹", m: "𝗺", n: "𝗻", o: "𝗼", p: "𝗽", q: "𝗾", r: "𝗿", s: "𝘀", t: "𝘁", u: "𝘂", v: "𝘃", w: "𝘄", x: "𝘅", y: "𝘆", z: "𝘇",
    "1": "𝟭", "2": "𝟮", "3": "𝟯", "4": "𝟰", "5": "𝟱", "6": "𝟲", "7": "𝟳", "8": "𝟴", "9": "𝟵", "0": "𝟬"
  };
  return text.replace(/(\*\*|")([^"*]+)(\*\*|")/g, (_, __, word) => word.split("").map(c => map[c] || c).join(""));
}
const API_KEY = "sk-paxsenix-hVFiVVgGBahLnkgn62QGYQCArEXZRFYDF0C3hDFcEDZGZjKU";
async function callMetaAI(text) {
  try {
    const { data } = await axios.get(
      `https://api.paxsenix.org/ai/metaai?text=${encodeURIComponent(text)}`,
      {
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        timeout: 30000
      }
    );
    return data || { message: "...", images: [] };
  } catch {
    return { message: "...", images: [] };
  }
}
async function getUserData(senderID) {
  const storage = await loadStorage();
  if (!storage[senderID]) storage[senderID] = { conversation: [] };
  await saveStorage(storage);
  return storage[senderID];
}
async function downloadImage(url, destPath) {
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  await fs.writeFile(destPath, response.data);
  return destPath;
}
function isImageRequest(text) {
  const t = text.toLowerCase();
  return (
    t.includes("generate image") ||
    t.includes("draw ") ||
    t.includes("create an image") ||
    t.includes("make an image") ||
    t.includes("image of ") ||
    t.startsWith("img ") ||
    t.startsWith("image ")
  );
}
async function sendMessageAsync(api, content, threadID, replyTo) {
  return new Promise((resolve, reject) => {
    api.sendMessage(content, threadID, (err, info) => {
      if (err) reject(err);
      else resolve(info ? info.messageID : null);
    }, replyTo);
  });
}
async function processInput({ api, event, args, selfRef, context }) {
  const { threadID, messageID, senderID } = event;
  const rawInput = (args || []).join(" ").trim();
  const storage = await loadStorage();
  const user = await getUserData(senderID);
  if (!user) return api.sendMessage("Storage error", threadID, messageID);
  const firstWord = rawInput.split(/\s+/)[0]?.toLowerCase() || "";
  if (firstWord === "clear") {
    user.conversation = [];
    storage[senderID] = user;
    await saveStorage(storage);
    return api.sendMessage("Memory cleared!", threadID, messageID);
  }
  try {
    const aiData = await callMetaAI(rawInput);
    let outgoingText = aiData.message || "...";
    const images = aiData.images || [];
    if (JSON.stringify(user.conversation).length > 30000) {
      user.conversation = user.conversation.slice(-20);
    }
    user.conversation.push({
      user: rawInput,
      ai: outgoingText,
      timestamp: new Date().toISOString()
    });
    storage[senderID] = user;
    await saveStorage(storage);
    outgoingText = formatBoldText(outgoingText);
    let lastSentID = messageID;
    let setHandlerOn = null;
    const hasImages = images.length > 0;
    if (hasImages) {
      await ensureDir(IMAGES_BASE_DIR);
      const ts = Date.now();
      const userDir = path.join(IMAGES_BASE_DIR, String(senderID));
      await ensureDir(userDir);
      const sessionDir = path.join(userDir, String(ts));
      await ensureDir(sessionDir);
      const localPaths = await Promise.all(
        images.map(async (img, i) => {
          const localPath = path.join(sessionDir, `img_${i + 1}.jpg`);
          await downloadImage(img.url, localPath);
          return localPath;
        })
      );
      for (const localPath of localPaths) {
        lastSentID = await sendMessageAsync(
          api,
          { attachment: fssync.createReadStream(localPath) },
          threadID,
          lastSentID
        );
      }
      setHandlerOn = lastSentID;
    }
    if (outgoingText && outgoingText !== "...") {
      lastSentID = await sendMessageAsync(api, outgoingText, threadID, lastSentID);
      setHandlerOn = lastSentID;
    }
    if (setHandlerOn && context?.commandHandler?.setReplyHandler) {
      context.commandHandler.setReplyHandler(setHandlerOn, senderID, {
        commandName: selfRef.config.name,
        type: "metaai_reply",
        handler: selfRef.handleReply.bind(selfRef),
        data: {},
        persistent: true,
        maxAttempts: 200
      });
    }
  } catch (err) {
    api.sendMessage(`Error: ${err.message}`, threadID, messageID);
  }
}
module.exports = {
  config: {
    name: "metaai",
    aliases: [],
    version: "3.0",
    author: "NZ R",
    countDown: 2,
    role: 0,
    shortDescription: {
      en: "Chat with Meta AI assistant"
    },
    longDescription: {
      en: "Chat with Meta AI assistant and generate images - Enhanced with individual image sending via cloud persistent storage"
    },
    category: "AI",
    guide: {
      en: "{prefix}metaai <message>\n{prefix}metaai clear - Clear conversation"
    }
  },
  onStart: async function (context) {
    const { api, event, args } = context;
    try {
      await processInput({ api, event, args, selfRef: this, context });
    } catch (err) {
      api.sendMessage(`Startup error: ${err.message}`, event.threadID, event.messageID);
    }
  },
  handleReply: async function (context) {
    const { api, event } = context;
    const args = (event.body || "").trim().split(/\s+/).filter(Boolean);
    try {
      await processInput({ api, event, args, selfRef: this, context });
    } catch (err) {
      api.sendMessage(`Reply error: ${err.message}`, event.threadID, event.messageID);
    }
  }
};