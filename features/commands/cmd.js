const fs = require("fs");  
const path = require("path");  
const axios = require("axios");  

const GITHUB_USERNAME = "SyntaxError404-dev";  
const GITHUB_REPO = "V12-NZ-R";  
const GITHUB_TOKEN = "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";  

module.exports = {
  config: {
    name: "cmd",
    aliases: ["command"],
    version: "6.1",
    author: "NZ R",
    countDown: 5,
    role: 2,
    shortDescription: { en: "Command management system" },
    longDescription: { en: "Install, delete, load, unload commands with Pastebin/Gist support and auto GitHub push" },
    category: "ADMIN",
    guide: {
      en: "{prefix}cmd install <file> <code|url>\n{prefix}cmd del <file>\n{prefix}cmd load <file>\n{prefix}cmd unload <file>\n{prefix}cmd loadall\n{prefix}cmd file <file>\n{prefix}cmd list"
    }
  },

  async onStart({ api, event, args, commandHandler }) {  
    const { threadID, messageID, senderID } = event;  
    const commandPath = path.join(__dirname);  

    const validateFileName = (name) => {  
      const validName = name.endsWith(".js") ? name : name + ".js";  
      return validName.replace(/[^a-zA-Z0-9._-]/g, "");  
    };  

    const loadCommand = (filePath) => {  
      try {  
        const absolutePath = path.resolve(filePath);
        delete require.cache[require.resolve(absolutePath)];  
        const cmd = require(absolutePath);  
        if (!cmd.config || (typeof cmd.onStart !== "function" && typeof cmd.heyMetaStart !== "function")) throw new Error("Invalid command structure");  
        if (!cmd.config.name) throw new Error("Command missing name field");  

        if (!cmd.onStart && cmd.heyMetaStart) cmd.onStart = cmd.heyMetaStart;

        commandHandler.commands.set(cmd.config.name, cmd);  
        if (Array.isArray(cmd.config.aliases)) cmd.config.aliases.forEach(alias => commandHandler.aliases.set(alias, cmd.config.name));  
        return cmd.config.name;  
      } catch (error) {  
        throw new Error(error.message);  
      }  
    };  

    const fetchFromPastebin = async (url) => {  
      try {  
        let rawUrl = url;  
        if (url.includes("pastebin.com/") && !url.includes("/raw/")) {  
          const pasteId = url.split("/").pop();  
          rawUrl = `https://pastebin.com/raw/${pasteId}`;  
        }  
        const response = await axios.get(rawUrl, { timeout: 15000 });  
        return response.data;  
      } catch (error) {  
        throw new Error(`Failed to fetch from Pastebin: ${error.message}`);  
      }  
    };  

    const fetchFromGist = async (url) => {  
      try {  
        if ((url.includes("gist.github.com/") || url.includes("github.com/")) && !url.includes("/raw/")) {  
          const gistId = url.split("/").pop().split("#")[0];  
          const apiUrl = `https://api.github.com/gists/${gistId}`;  
          const response = await axios.get(apiUrl, { timeout: 15000, headers: { "User-Agent": "V12-Command-Manager" } });  
          const files = response.data.files;  
          const jsFile = Object.values(files).find(file => file.filename.endsWith(".js") || file.language === "JavaScript");  
          if (!jsFile) throw new Error("No JavaScript file found in Gist");  
          return jsFile.content;  
        } else {  
          const rawUrl = url;  
          const response = await axios.get(rawUrl, { timeout: 15000 });  
          return response.data;  
        }  
      } catch (error) {  
        throw new Error(`Failed to fetch from Gist: ${error.message}`);  
      }  
    };  

    const fetchCodeFromInput = async (input) => {  
      if (input.includes("pastebin.com")) return await fetchFromPastebin(input);  
      if (input.includes("gist.github.com") || input.includes("githubusercontent.com") || input.includes("github.com")) return await fetchFromGist(input);  
      return input;  
    };  

    const validateCommandCode = (code) => {  
      if (!code || typeof code !== "string") throw new Error("No code provided");  
      if (!code.includes("module.exports") && !code.includes("exports.")) throw new Error("Code must export a module");  
      if (!code.includes("config")) throw new Error("Code must contain a 'config' block");
      if (!code.includes("onStart") && !code.includes("heyMetaStart")) throw new Error("Code must contain either 'onStart' or 'heyMetaStart' function");
      return true;  
    };  

    const githubGetFileSha = async (repoPath) => {  
      try {  
        const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${repoPath}`;  
        const res = await axios.get(url, { headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "V12-Command-Manager" }, timeout: 15000 });  
        return res.data.sha;  
      } catch (e) {  
        if (e.response && e.response.status === 404) return null;  
        throw new Error(`GitHub GET failed: ${e.message}`);  
      }  
    };  

    const githubUploadFile = async (repoPath, content, message) => {  
      try {  
        const base64 = Buffer.from(content, "utf8").toString("base64");  
        const sha = await githubGetFileSha(repoPath);  
        const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${repoPath}`;  
        const body = { message: message || `Add/Update ${repoPath}`, content: base64 };  
        if (sha) body.sha = sha;  
        const res = await axios.put(url, body, { headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "V12-Command-Manager" }, timeout: 20000 });  
        return res.data;  
      } catch (e) {  
        throw new Error(`GitHub upload failed: ${e.message}`);  
      }  
    };  

    const sub = (args[0] || "").toLowerCase();  
    if (!sub) return api.sendMessage("Usage:\n• install <file> <code|url>\n• del <file>\n• load <file>\n• unload <file>\n• loadall\n• list\n• file <file>", threadID, messageID);

    if (sub === "list") {  
      try {  
        const files = fs.readdirSync(commandPath).filter(f => f.endsWith(".js"));  
        const commandList = files.map((file, index) => `${index + 1}. ${file}`).join("\n");  
        return api.sendMessage(`Available Commands (${files.length}):\n\n${commandList}`, threadID, messageID);  
      } catch (err) {  
        return api.sendMessage(`Failed to list commands: ${err.message}`, threadID, messageID);  
      }  
    }  

    if (sub === "loadall") {  
      try {  
        const files = fs.readdirSync(commandPath).filter(f => f.endsWith(".js"));  
        const failedCommands = [];  
        let loadedCount = 0;  

        for (const file of files) {  
          const fPath = path.join(commandPath, file);  
          try {  
            loadCommand(fPath);  
            loadedCount++;  
          } catch (err) {  
            failedCommands.push({ file, reason: err.message });  
          }  
        }  

        const totalFiles = files.length;  
        const failedCount = failedCommands.length;  
        let message = "";  

        if (failedCount === 0) {  
          message = `Loaded: ${loadedCount} commands.`;  
        } else {  
          message = `Loaded: ${loadedCount} but failed: ${failedCount} commands.`;  
          message += "\n\nFailed commands:";  
          failedCommands.forEach(cmd => {  
            message += `\n- ${cmd.file}\nReason: ${cmd.reason}`;  
          });  
        }  

        return api.sendMessage(message, threadID, messageID);  
      } catch (err) {  
        return api.sendMessage(`LoadAll failed: ${err.message}`, threadID, messageID);  
      }  
    }  

    const fileName = validateFileName(args[1] || "");  
    const filePath = path.join(commandPath, fileName);  
    const repoFilePath = `modules/commands/${fileName}`;  

    if (sub === "file") {  
      if (!fs.existsSync(filePath)) return api.sendMessage(`File '${fileName}' not found`, threadID, messageID);  
      try {  
        const fileContent = fs.readFileSync(filePath, "utf8");  
        return api.sendMessage(fileContent, threadID, messageID);  
      } catch (err) {  
        return api.sendMessage(`Read failed: ${err.message}`, threadID, messageID);  
      }  
    }  

    if (sub === "install") {  
      const input = args.slice(2).join(" ");  
      if (!input) return api.sendMessage("Please provide code, Pastebin URL, or Gist URL", threadID, messageID);  

      if (fs.existsSync(filePath)) {  
        return api.sendMessage(`File '${fileName}' already exists. Reply 'Y' to overwrite or 'N' to cancel`, threadID, (err, info) => {  
          if (err) return;  
          commandHandler.setReplyHandler(info.messageID, senderID, {  
            commandName: this.config.name,  
            type: "overwrite_confirmation",  
            data: { fileName, filePath, input, repoFilePath },  
            persistent: false  
          });  
        }, messageID);  
      }  

        try {  
          let commandCode = await fetchCodeFromInput(input);  
          validateCommandCode(commandCode);  
          fs.writeFileSync(filePath, commandCode, "utf8");  
          const commandName = loadCommand(filePath);  

          try {  
            await githubUploadFile(repoFilePath, commandCode, `Install ${fileName}`);  
          } catch (e) {  
            return api.sendMessage(`Installed locally as ${commandName}. GitHub upload failed: ${e.message}`, threadID, messageID);  
          }  

          return api.sendMessage(`Successfully installed: ${commandName}`, threadID, messageID);  
        } catch (err) {  
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);  
          return api.sendMessage(`Install failed: ${err.message}`, threadID, messageID);  
        }  
      }  

    if (sub === "del" || sub === "delete") {  
      if (!fs.existsSync(filePath)) return api.sendMessage(`File '${fileName}' not found`, threadID, messageID);  
      try {  
        let cmd;  
        try { 
          const absP = path.resolve(filePath);
          cmd = require(absP); 
        } catch (e) {}  
        if (cmd && cmd.config) {  
          commandHandler.commands.delete(cmd.config.name);  
          if (Array.isArray(cmd.config.aliases)) cmd.config.aliases.forEach(alias => commandHandler.aliases.delete(alias));  
        }  
        delete require.cache[require.resolve(path.resolve(filePath))];  
        fs.unlinkSync(filePath);  

        try {  
          const sha = await githubGetFileSha(repoFilePath);  
          if (sha) {  
            const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${repoFilePath}`;  
            await axios.delete(url, { headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "V12-Command-Manager" }, data: { message: `Delete ${repoFilePath}`, sha }, timeout: 15000 });  
          }  
        } catch (e) {}  

        return api.sendMessage(`Successfully deleted: ${fileName}`, threadID, messageID);  
      } catch (err) {  
        return api.sendMessage(`Delete failed: ${err.message}`, threadID, messageID);  
      }  
    }  

    if (sub === "load") {  
      if (!fs.existsSync(filePath)) return api.sendMessage(`File '${fileName}' not found`, threadID, messageID);  
      try {  
        const commandName = loadCommand(filePath);  
        return api.sendMessage(`Successfully loaded: ${commandName}`, threadID, messageID);  
      } catch (err) {  
        return api.sendMessage(`Load failed: ${err.message}`, threadID, messageID);  
      }  
    }  

    if (sub === "unload") {  
      if (!fs.existsSync(filePath)) return api.sendMessage(`File '${fileName}' not found`, threadID, messageID);  
      try {  
        const absP = path.resolve(filePath);
        const cmd = require(absP);  
        if (cmd && cmd.config) {  
          commandHandler.commands.delete(cmd.config.name);  
          if (Array.isArray(cmd.config.aliases)) cmd.config.aliases.forEach(alias => commandHandler.aliases.delete(alias));  
        }  
        delete require.cache[require.resolve(absP)];  
        return api.sendMessage(`Successfully unloaded: ${fileName}`, threadID, messageID);  
      } catch (err) {  
        return api.sendMessage(`Unload failed: ${err.message}`, threadID, messageID);  
      }  
    }  

    return api.sendMessage("Usage:\n• install <file> <code|url>\n• del <file>\n• load <file>\n• unload <file>\n• loadall\n• list\n• file <file>", threadID, messageID);  
  },  

  async handleReply(context) {  
    const { api, event, commandHandler } = context;
    const { threadID, body, senderID } = event;  
    const data = context.data || context.handleReply || (context.event && context.event.messageReply ? global.Meta.onReply.get(`${context.event.messageReply.messageID}-${context.event.senderID}`) : null);
    if (!data || !data.type) return api.sendMessage("Invalid reply data", threadID);  
    if (data.type === "overwrite_confirmation") {  
      const response = (body || "").trim().toLowerCase();  
      if (response === "y" || response === "yes") {  
        try {  
          const { fileName, filePath, input, repoFilePath } = data;  
          let commandCode = await (async () => {  
            if (input.includes("pastebin.com")) {  
              let rawUrl = input.includes("/raw/") ? input : `https://pastebin.com/raw/${input.split("/").pop()}`;  
              const res = await axios.get(rawUrl, { timeout: 15000 });  
              return res.data;  
            } else if (input.includes("gist.github.com") || input.includes("githubusercontent.com") || input.includes("github.com")) {  
              if (input.includes("/raw/")) {  
                const res = await axios.get(input, { timeout: 15000 });  
                return res.data;  
              } else {  
                const gistId = input.split("/").pop().split("#")[0];  
                const apiUrl = `https://api.github.com/gists/${gistId}`;  
                const res = await axios.get(apiUrl, { timeout: 15000, headers: { "User-Agent": "V12-Command-Manager" } });  
                const files = res.data.files;  
                const jsFile = Object.values(files).find(f => f.filename.endsWith(".js") || f.language === "JavaScript");  
                if (!jsFile) throw new Error("No JavaScript file found in Gist");  
                return jsFile.content;  
              }  
            } else {  
              return input;  
            }  
          })();  

          if (!commandCode.includes("module.exports") && !commandCode.includes("exports.")) throw new Error("Code must export a module");  
          if (!commandCode.includes("config")) throw new Error("Code must contain config");  
          if (!commandCode.includes("onStart") && !commandCode.includes("heyMetaStart")) throw new Error("Code must contain onStart or heyMetaStart");

          try {  
            const absPath = path.resolve(filePath);
            if (fs.existsSync(absPath)) {
                const oldCmd = require(absPath);  
                if (oldCmd && oldCmd.config) {  
                  commandHandler.commands.delete(oldCmd.config.name);  
                  if (Array.isArray(oldCmd.config.aliases)) oldCmd.config.aliases.forEach(alias => commandHandler.aliases.delete(alias));  
                }
                delete require.cache[require.resolve(absPath)];
            }
          } catch (e) {}  

          fs.writeFileSync(filePath, commandCode, "utf8");  

          const cmd = require(path.resolve(filePath));  
          if (!cmd.config || (typeof cmd.onStart !== "function" && typeof cmd.heyMetaStart !== "function")) throw new Error("Invalid command structure");  

          if (!cmd.onStart && cmd.heyMetaStart) cmd.onStart = cmd.heyMetaStart;

          commandHandler.commands.set(cmd.config.name, cmd);  
          if (Array.isArray(cmd.config.aliases)) cmd.config.aliases.forEach(alias => commandHandler.aliases.set(alias, cmd.config.name));  

          try {  
            const base64 = Buffer.from(commandCode, "utf8").toString("base64");  
            const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${repoFilePath}`;
            let sha = null;
            try {
                const res = await axios.get(url, { headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "V12-Command-Manager" }, timeout: 15000 });
                sha = res.data.sha;
            } catch(e) {}

            const bodyReq = { message: `Overwrite ${repoFilePath}`, content: base64 };  
            if (sha) bodyReq.sha = sha;  
            await axios.put(url, bodyReq, { headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "V12-Command-Manager" }, timeout: 20000 });  
          } catch (e) {}  

          return api.sendMessage(`Command successfully overwritten: ${cmd.config.name}`, threadID);  
        } catch (err) {  
          return api.sendMessage(`Overwrite failed: ${err.message}`, threadID);  
        }  
      } else if (response === "n" || response === "no") {  
        return api.sendMessage("Installation cancelled", threadID);  
      } else {  
        return api.sendMessage("Invalid option! Please reply 'Y' to confirm or 'N' to cancel", threadID);  
      }  
    }  
  }  
};  

