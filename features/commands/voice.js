const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_KEY = "fgsiapi-2affc76f-6d";
const BASE_URL = "https://fgsi.dpdns.org/api/ai/clonevoice/text-to-speech";

const VOICES = [
  { voice_id: "voice_donald_trump", name: "Donald Trump", gender: "male", language: "English" },
  { voice_id: "elon_musk", name: "Elon Musk", gender: "male", language: "en" },
  { voice_id: "voice_rick", name: "Rick", gender: "cartoon", language: "English" },
  { voice_id: "christiano_ronaldo", name: "Cristiano Ronaldo", gender: "male", language: "en" },
  { voice_id: "voice_doctor_strange", name: "Doctor Strange", gender: "male", language: "English" },
  { voice_id: "roseanne_park", name: "Rosé", gender: "female", language: "en" },
  { voice_id: "emma_watson", name: "Emma Watson", gender: "female", language: "en" },
  { voice_id: "kylie_jenner", name: "Kylie Jenner", gender: "female", language: "en" },
  { voice_id: "39ef049a-14c1-4774-8ee8-2e5c012c11a8", name: "Alex", gender: "female", language: "English" },
  { voice_id: "voice_sophia", name: "Sophia", gender: "female", language: "English" },
  { voice_id: "voice_james", name: "James", gender: "male", language: "English" },
  { voice_id: "ghostface", name: "Ghostface", gender: "male", language: "en" },
  { voice_id: "sonic", name: "Sonic", gender: "male", language: "en" },
  { voice_id: "voice_furina_", name: "Furina", gender: "cartoon", language: "English" }
];

function similarity(a, b) {
  a = a.toLowerCase().replace(/\s+/g, "");
  b = b.toLowerCase().replace(/\s+/g, "");
  if (b.includes(a) || a.includes(b)) return 1;
  let matches = 0;
  for (const ch of a) {
    if (b.includes(ch)) matches++;
  }
  return matches / Math.max(a.length, b.length);
}

function findVoice(query) {
  query = query.toLowerCase().trim();
  let best = null;
  let bestScore = 0;
  for (const v of VOICES) {
    const nameClean = v.name.toLowerCase().replace(/\s+/g, "");
    const queryClean = query.replace(/\s+/g, "");
    const idClean = v.voice_id.toLowerCase().replace(/[_\-]/g, "");
    const score = Math.max(
      similarity(queryClean, nameClean),
      similarity(queryClean, idClean)
    );
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return bestScore >= 0.4 ? best : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function pollResult(pollUrl, maxAttempts = 20, interval = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(interval);
    const { data } = await axios.get(pollUrl, { timeout: 15000 });
    if (data.data && data.data.status === "Success" && data.data.result && data.data.result.audioUrl) {
      return data.data.result.audioUrl;
    }
    if (data.data && data.data.status === "Failed") {
      throw new Error("Voice generation failed.");
    }
  }
  throw new Error("Timed out waiting for audio.");
}

module.exports = {
  config: {
    name: "voice",
    aliases: [],
    version: "1.0",
    author: "NZ R",
    countDown: 10,
    role: 0,
    shortDescription: { en: "Text to speech with celebrity voices" },
    longDescription: { en: "Convert text to speech using a celebrity voice clone." },
    category: "AI",
    guide: { en: "{prefix}voice <text> | <voice name>\n{prefix}voice list" }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;
    const input = args.join(" ").trim();

    if (!input || input.toLowerCase() === "list") {
      const list = VOICES.map(v => `${v.name} (${v.language})`).join("\n");
      return api.sendMessage("Available voices:\n\n" + list, threadID, messageID);
    }

    const pipeIndex = input.lastIndexOf("|");
    let text, voiceQuery;

    if (pipeIndex !== -1) {
      text = input.slice(0, pipeIndex).trim();
      voiceQuery = input.slice(pipeIndex + 1).trim();
    } else {
      const parts = input.split(/\s+/);
      if (parts.length < 2) {
        return api.sendMessage("Usage: voice <text> | <voice name>", threadID, messageID);
      }
      const lastTwo = parts.slice(-2).join(" ");
      const lastOne = parts[parts.length - 1];
      const matchTwo = findVoice(lastTwo);
      const matchOne = findVoice(lastOne);
      if (matchTwo) {
        voiceQuery = lastTwo;
        text = parts.slice(0, -2).join(" ").trim();
      } else if (matchOne) {
        voiceQuery = lastOne;
        text = parts.slice(0, -1).join(" ").trim();
      } else {
        return api.sendMessage("Could not find that voice. Type 'voice list' to see all available voices.", threadID, messageID);
      }
    }

    if (!text) {
      return api.sendMessage("Please include the text to speak.", threadID, messageID);
    }

    const voice = findVoice(voiceQuery);
    if (!voice) {
      return api.sendMessage("Could not match that voice. Type 'voice list' to see all available voices.", threadID, messageID);
    }

    try {
      const { data: taskData } = await axios.get(BASE_URL, {
        params: { apikey: API_KEY, text: text, voice_id: voice.voice_id },
        timeout: 20000
      });

      if (!taskData.status || !taskData.data || !taskData.data.pollUrl) {
        return api.sendMessage("Failed to start voice generation.", threadID, messageID);
      }

      const audioUrl = await pollResult(taskData.data.pollUrl);

      const tmpPath = path.join(__dirname, `voice_${Date.now()}.wav`);
      const audioResponse = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 30000 });
      fs.writeFileSync(tmpPath, audioResponse.data);

      await new Promise((resolve, reject) => {
        api.sendMessage(
          { attachment: fs.createReadStream(tmpPath) },
          threadID,
          (err) => {
            fs.unlink(tmpPath, () => {});
            if (err) reject(err);
            else resolve();
          },
          messageID
        );
      });
    } catch (err) {
      api.sendMessage("Something went wrong: " + err.message, threadID, messageID);
    }
  }
};
