const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const imgbbApiKey = "1b4d99fa0c3195efe42ceb62670f2a25";
const supabaseUrl = "https://gjosebfngzowbcrwzxnw.supabase.co/functions/v1/openai-compatible";
const supabaseAuth = "Bearer nb_SBa89oD7xBbHSrwJKny3acDF6kRFuPBNgF2BEEDTdnRGMyBe";

module.exports = {
  config: {
    name: "edit",
    aliases: [],
    version: "1.0",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: {
      en: "Edit image by removing text"
    },
    longDescription: {
      en: "Remove all text from an image using AI"
    },
    category: "IMAGE",
    guide: {
      en: "Reply to an image with {prefix}edit <prompt>"
    }
  },

  async onStart({ api, event, args }) {
    const { threadID, messageID, messageReply } = event;

    if (!messageReply || !messageReply.attachments || messageReply.attachments.length === 0) {
      return api.sendMessage("Please reply to an image", threadID, messageID);
    }

    const prompt = args.length > 0 ? args.join(" ") : "remove all the text from that image";

    try {
      const imageUrl = messageReply.attachments[0].url;
      
      const loadingMsg = await api.sendMessage("Processing image...", threadID, messageID);

      const imgbbUrl = await uploadToImgbb(imageUrl);
      const result = await callSupabaseAPI(imgbbUrl, prompt);

      if (result.error) {
        api.unsendMessage(loadingMsg.messageID);
        return api.sendMessage(`Error: ${result.error}`, threadID, messageID);
      }

      const imageBuffer = Buffer.from(result, "base64");
      const imagePath = path.join(__dirname, `../../temp/edit_${Date.now()}.png`);
      const tempDir = path.dirname(imagePath);

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      fs.writeFileSync(imagePath, imageBuffer);

      const stream = fs.createReadStream(imagePath);
      await api.sendMessage({ attachment: stream }, threadID, messageID);

      api.unsendMessage(loadingMsg.messageID);

      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    } catch (err) {
      api.sendMessage(`Error: ${err.message}`, threadID, messageID);
    }
  },

  handleReply: async () => {}
};

async function uploadToImgbb(imageUrl) {
  try {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const formData = new FormData();
    formData.append("image", Buffer.from(response.data), "image.jpg");

    const uploadRes = await axios.post("https://api.imgbb.com/1/upload", formData, {
      headers: formData.getHeaders(),
      params: { key: imgbbApiKey }
    });

    return uploadRes.data?.data?.url;
  } catch (err) {
    throw new Error(`Failed to upload image to ImgBB: ${err.message}`);
  }
}

async function callSupabaseAPI(imageUrl, prompt) {
  try {
    const response = await axios.post(
      supabaseUrl,
      {
        model: "gemini-3.1-pro-preview",
        prompt: prompt,
        images: [imageUrl]
      },
      {
        headers: {
          Authorization: supabaseAuth,
          "Content-Type": "application/json"
        },
        timeout: 120000
      }
    );

    let imageData = null;

    if (response.data && typeof response.data === "string" && response.data.includes(",")) {
      imageData = response.data.split(",")[1] || response.data;
    } else if (response.data && response.data.image) {
      imageData = response.data.image;
    } else if (response.data && response.data.result) {
      imageData = response.data.result;
    } else if (response.data && response.data.output) {
      imageData = response.data.output;
    } else if (response.data && response.data.data) {
      imageData = response.data.data;
    } else if (typeof response.data === "string") {
      imageData = response.data;
    }

    if (!imageData) {
      throw new Error(`Unexpected response structure: ${JSON.stringify(response.data).substring(0, 200)}`);
    }

    return imageData;
  } catch (err) {
    throw new Error(`API call failed: ${err.message}`);
  }
}