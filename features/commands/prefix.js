const fs = require('fs');
const path = require('path');
const config = require('../../core_settings/config.json');
const groupPrefixFile = path.join(__dirname, '../../features/commands/group.json');

function loadGroupPrefixes() {
  if (!fs.existsSync(groupPrefixFile)) {
    fs.writeFileSync(groupPrefixFile, '{}');
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(groupPrefixFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveGroupPrefixes(data) {
  fs.writeFileSync(groupPrefixFile, JSON.stringify(data, null, 2));
}

module.exports = {
  config: {
    name: "prefix",
    aliases: [],
    version: "2.0",
    author: "NZ R",
    countDown: 5,
    role: 0,
    shortDescription: {
      en: "Set custom prefix for this group"
    },
    longDescription: {
      en: "Change or reset the bot prefix for this group or all groups."
    },
    category: "SYSTEM",
    guide: {
      en: "{prefix}prefix <new_prefix>\n{prefix}prefix reset - Reset for this group\n{prefix}prefix resetall - Reset for all groups"
    }
  },

  async onStart({ api, event, args, commandHandler }) {
    const { threadID, messageID, senderID } = event;
    const systemPrefix = config.bot.prefix;
    const groupPrefixes = loadGroupPrefixes();
    const currentGroupPrefix = groupPrefixes[threadID] || systemPrefix;

    if (!args.length) {
      if (currentGroupPrefix === systemPrefix) {
        return api.sendMessage(`Current configuration:\nActive Prefix: ${systemPrefix}`, threadID, messageID);
      } else {
        return api.sendMessage(`Current configuration:\nGroup Prefix: ${currentGroupPrefix}\nSystem Prefix: ${systemPrefix}`, threadID, messageID);
      }
    }

    const action = args[0].toLowerCase();

    if (action === 'reset') {
      if (currentGroupPrefix === systemPrefix) {
        return api.sendMessage(`This group is already using the system prefix ${systemPrefix}`, threadID, messageID);
      }
      const confirmMsg = await api.sendMessage(`Confirm prefix reset to system default for this group?\n\nReply Y to confirm or N to cancel`, threadID, messageID);
      if (commandHandler?.setReplyHandler) {
        commandHandler.setReplyHandler(confirmMsg.messageID, senderID, {
          commandName: "prefix",
          type: "reset_confirm",
          confirmMsgID: confirmMsg.messageID
        });
      }
      return;
    }

    if (action === 'resetall') {
      if (Object.keys(groupPrefixes).length === 0) {
        return api.sendMessage("No group prefixes found to reset.", threadID, messageID);
      }
      const confirmMsg = await api.sendMessage(`Confirm prefix reset to system default for all groups?\n\nReply Y to confirm or N to cancel`, threadID, messageID);
      if (commandHandler?.setReplyHandler) {
        commandHandler.setReplyHandler(confirmMsg.messageID, senderID, {
          commandName: "prefix",
          type: "resetall_confirm",
          confirmMsgID: confirmMsg.messageID
        });
      }
      return;
    }

    const newPrefix = args[0];
    if (newPrefix.length > 5) {
      return api.sendMessage("Prefix cannot exceed 5 characters.", threadID, messageID);
    }

    groupPrefixes[threadID] = newPrefix;
    saveGroupPrefixes(groupPrefixes);
    return api.sendMessage(`Prefix changed successfully for this group.\nNew Prefix: ${newPrefix}`, threadID, messageID);
  },

  async onReply({ api, event, Reply, commandHandler }) {
    const { threadID, messageID, body, senderID } = event;
    const { type, confirmMsgID } = Reply;

    if (senderID !== Reply.senderID) return;

    if (type === "reset_confirm") {
      if (body.toLowerCase() === 'y') {
        const groupPrefixes = loadGroupPrefixes();
        delete groupPrefixes[threadID];
        saveGroupPrefixes(groupPrefixes);
        
        await api.unsendMessage(confirmMsgID);
        return api.sendMessage(`Prefix reset successful.\nThis group is now using the system prefix: ${config.bot.prefix}`, threadID, messageID);
      } else if (body.toLowerCase() === 'n') {
        await api.unsendMessage(confirmMsgID);
        return api.sendMessage("Reset cancelled.", threadID, messageID);
      }
    }

    if (type === "resetall_confirm") {
      if (body.toLowerCase() === 'y') {
        saveGroupPrefixes({});
        await api.unsendMessage(confirmMsgID);
        return api.sendMessage(`All group prefixes have been reset to system default: ${config.bot.prefix}`, threadID, messageID);
      } else if (body.toLowerCase() === 'n') {
        await api.unsendMessage(confirmMsgID);
        return api.sendMessage("Reset cancelled.", threadID, messageID);
      }
    }
  }
};