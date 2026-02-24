const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = {
  config: {
    name: "shell",
    aliases: ["sh"],
    version: "1.0",
    author: "NZ R",
    countDown: 3,
    role: 2,
    shortDescription: {
      en: "Execute shell commands"
    },
    longDescription: {
      en: "Execute terminal commands with output capture and error handling."
    },
    category: "ADMIN",
    guide: {
      en: "{prefix}shell <command>\n{prefix}sh ls -la\n{prefix}shell pwd"
    }
  },

  async onStart({ api, event, args }) {
    const { threadID, messageID, senderID } = event;

    if (!args.length) {
      return api.sendMessage("Please tell me which command to run.", threadID, messageID);
    }

    const command = args.join(" ");

    const dangerousCommands = [
      'rm -rf', 'sudo rm', 'format', 'fdisk', 'mkfs', 'dd if=', 'shutdown', 'reboot', 'halt', 'init 0', 'killall', 'pkill -9', '> /dev/', 'chmod 777 /'
    ];

    const isDangerous = dangerousCommands.some(cmd => command.toLowerCase().includes(cmd.toLowerCase()));

    if (isDangerous) {
      return api.sendMessage("That command is blocked for security reasons. Can't run it!", threadID, messageID);
    }

    try {
      const result = await new Promise((resolve) => {
        const options = {
          timeout: 60000,
          maxBuffer: 1024 * 1024 * 10, 
          cwd: process.cwd(),
          env: process.env
        };

        exec(command, options, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, output: stderr || error.message });
          } else {
            resolve({ success: true, output: stdout || stderr || "Command ran successfully." });
          }
        });
      });

      let response = result.output;

      if (response.length > 2000) {
        const truncated = result.output.substring(0, 1900);
        response = `Output is quite long, so I've shortened it:\n${truncated}...\n[Full output too large to display.]`;
      }

      return api.sendMessage(response, threadID, messageID);

    } catch (error) {
      return api.sendMessage(
        `Something went wrong: ${error.message}`,
        threadID,
        messageID
      );
    }
  }
};
