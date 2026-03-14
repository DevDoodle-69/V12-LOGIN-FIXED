const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const config = require('../../core_settings/config.json');
const { connect } = require('../database');
const genderDetector = require('../gender/detector');

global.Meta = global.Meta || {};
global.Meta.onReply = new Map();
global.Meta.menuStates = new Map();
global.Meta.whitelistMode = true;
global.Meta.selfListenMode = true;

class CommandHandler {
    constructor(api) {
        this.api = api;
        this.commands = new Map();
        this.aliases = new Map();
        this.cooldowns = new Map();
        this.db = null;
        this.adminIds = new Set(config.bot.adminUids);
        this.whitelist = new Set();
        this.initDb();
        this.loadCommands();
    }

    async initDb() {
        this.db = await connect();
        if (this.db) {
            const botSettingsCollection = this.db.collection('botSettings');
            const settings = await botSettingsCollection.findOne({});
            if (settings) {
                global.Meta.whitelistMode = settings.whitelistMode !== undefined ? settings.whitelistMode : true;
                if (settings.whitelist) {
                    this.whitelist = new Set(settings.whitelist);
                }
            } else {
                global.Meta.whitelistMode = true;
            }
        }
    }

    async saveSettings() {
        if (!this.db) return;
        const botSettingsCollection = this.db.collection('botSettings');
        const settings = {
            whitelistMode: global.Meta.whitelistMode,
            whitelist: Array.from(this.whitelist)
        };
        await botSettingsCollection.updateOne(
            {},
            { $set: settings },
            { upsert: true }
        );
    }

    validateCommandStructure(command) {
        const requiredConfig = ['name', 'version', 'author', 'category'];
        return command.config && 
               requiredConfig.every(field => field in command.config) && 
               (typeof command.onStart === 'function' || typeof command.heyMetaStart === 'function');
    }

    loadCommands() {
        const commandDir = path.join(__dirname, '../../features/commands');
        if (!fs.existsSync(commandDir)) {
            logger.error(`Command directory not found: ${commandDir}`);
            return;
        }
        const files = fs.readdirSync(commandDir).filter(file => file.endsWith('.js'));

        for (const file of files) {
            try {
                const commandPath = path.join(commandDir, file);
                delete require.cache[require.resolve(commandPath)];
                const command = require(commandPath);
                
                if (!this.validateCommandStructure(command)) {
                    logger.error(`[ERROR] Invalid command structure in ${file}. Missing config fields or start function.`);
                    continue;
                }

                // Support both onStart and heyMetaStart
                if (!command.onStart && command.heyMetaStart) {
                    command.onStart = command.heyMetaStart;
                }

                this.commands.set(command.config.name, command);
                if (Array.isArray(command.config.aliases)) {
                    command.config.aliases.forEach(alias => this.aliases.set(alias, command.config.name));
                }
                logger.info(`Loaded command: ${command.config.name}`);
            } catch (error) {
                logger.error(`Command load failed ${file}: ${error.message}`);
            }
        }
    }

    setReplyHandler(messageID, senderID, data) {
        const replyKey = `${messageID}-${senderID}`;
        global.Meta.onReply.set(replyKey, { ...data, timestamp: Date.now(), attempts: 0 });
    }

    async handleReplyFlow(event, replyData) {
        const { commandName, handler, data, type, menu, subCommand, options } = replyData;
        const command = this.commands.get(commandName);
        if (!command) return false;

        const context = {
            api: this.api,
            event,
            args: event.body.split(/\s+/),
            commandHandler: this,
            prefix: config.bot.prefix,
            config: command.config,
            data: replyData.data || data,
            type,
            menu,
            subCommand,
            options,
            usersData: {
                get: async (userId) => {
                    if (!this.db) return null;
                    const usersCollection = this.db.collection('users');
                    return await usersCollection.findOne({ userId }) || null;
                },
                set: async (userId, userData) => {
                    if (!this.db) return;
                    const usersCollection = this.db.collection('users');
                    await usersCollection.updateOne(
                        { userId },
                        { $set: userData },
                        { upsert: true }
                    );
                }
            },
            reply: (msg) => this.api.sendMessage(msg, event.threadID, event.messageID)
        };

        if (typeof handler === 'function') {
            await handler(context);
            return true;
        }

        if (command.handleReply) {
            await command.handleReply(context);
            return true;
        }

        return false;
    }

    async handleWhitelistCommand(event, args) {
        if (!this.adminIds.has(event.senderID)) return;

        const action = args[0]?.toLowerCase();
        const targetId = args[1];

        switch (action) {
            case 'on':
                global.Meta.whitelistMode = true;
                await this.saveSettings();
                this.api.sendMessage("Whitelist mode activated.", event.threadID, event.messageID);
                break;
            case 'off':
                global.Meta.whitelistMode = false;
                await this.saveSettings();
                this.api.sendMessage("Whitelist mode deactivated.", event.threadID, event.messageID);
                break;
            case 'add':
                if (targetId) {
                    this.whitelist.add(targetId);
                    await this.saveSettings();
                    this.api.sendMessage(`Added ${targetId} to the whitelist.`, event.threadID, event.messageID);
                } else {
                    this.api.sendMessage("Please provide a user or thread ID to add.", event.threadID, event.messageID);
                }
                break;
            case 'remove':
                if (targetId) {
                    if (this.whitelist.delete(targetId)) {
                        await this.saveSettings();
                        this.api.sendMessage(`Removed ${targetId} from the whitelist.`, event.threadID, event.messageID);
                    } else {
                        this.api.sendMessage(`${targetId} was not found in the whitelist.`, event.threadID, event.messageID);
                    }
                } else {
                    this.api.sendMessage("Please provide a user or thread ID to remove.", event.threadID, event.messageID);
                }
                break;
            case 'list':
                if (this.whitelist.size > 0) {
                    let list = "Whitelisted IDs:\n" + Array.from(this.whitelist).join("\n");
                    this.api.sendMessage(list, event.threadID, event.messageID);
                } else {
                    this.api.sendMessage("The whitelist is currently empty.", event.threadID, event.messageID);
                }
                break;
            default:
                this.api.sendMessage("Oops! Try: ∆whitelist [on/off/add/remove/list] <ID>", event.threadID, event.messageID);
                break;
        }
    }

    async handleHideCommand(event, args) {
        if (!this.adminIds.has(event.senderID)) return;

        const action = args[0]?.toLowerCase();
        const targetId = args[1];

        switch (action) {
            case 'on':
                global.Meta.hideMode = true;
                this.api.sendMessage("Hide mode activated.", event.threadID, event.messageID);
                break;
            case 'off':
                global.Meta.hideMode = false;
                this.api.sendMessage("Hide mode deactivated.", event.threadID, event.messageID);
                break;
            default:
                this.api.sendMessage("Oops! Try: ∆hide [on/off]", event.threadID, event.messageID);
                break;
        }
    }

    async handleTextIdentifier(event) {
        const body = event.body?.trim().toLowerCase();
        if (body === 'prefix') {
            const groupPrefixFile = path.join(__dirname, '../../features/commands/group.json');
            let groupPrefixes = {};
            if (fs.existsSync(groupPrefixFile)) {
                try {
                    groupPrefixes = JSON.parse(fs.readFileSync(groupPrefixFile, 'utf8'));
                } catch (error) {
                    groupPrefixes = {};
                }
            }
            
            const systemPrefix = config.bot.prefix;
            const currentGroupPrefix = groupPrefixes[event.threadID];
            
            try {
                if (currentGroupPrefix && currentGroupPrefix !== systemPrefix) {
                    this.api.sendMessage(`Your Group Prefix: ${currentGroupPrefix}\nSystem Prefix: ${systemPrefix}`, event.threadID, event.messageID);
                } else {
                    this.api.sendMessage(`Prefix: ${systemPrefix}`, event.threadID, event.messageID);
                }
            } catch (err) {
                logger.error(`Failed to send prefix message: ${err.message}`);
            }
        }
    }

    async handleCommand(event) {
        if (!event?.body && !event.messageReply) return;

        const botID = this.api.getCurrentUserID();
        const isAdmin = this.adminIds.has(event.senderID);
        const isWhitelisted = this.whitelist.has(event.threadID) || this.whitelist.has(event.senderID);

        // Fix: Ensure specific group ID 826557190222026 is always allowed to process commands
        const isProblematicGroup = event.threadID === "826557190222026";

        if (global.Meta.whitelistMode && !isAdmin && !isWhitelisted && !isProblematicGroup) return;

        await this.handleTextIdentifier(event);

        if (event.messageReply) {
            const replyKey = `${event.messageReply.messageID}-${event.senderID}`;
            const replyData = global.Meta.onReply.get(replyKey);

            if (replyData) {
                try {
                    const handled = await this.handleReplyFlow(event, replyData);
                    if (handled) {
                        if (!replyData.persistent) {
                            global.Meta.onReply.delete(replyKey);
                        } else {
                            replyData.attempts = (replyData.attempts || 0) + 1;
                            if (replyData.maxAttempts && replyData.attempts >= replyData.maxAttempts) {
                                global.Meta.onReply.delete(replyKey);
                            } else {
                                global.Meta.onReply.set(replyKey, replyData);
                            }
                        }
                        return;
                    }
                } catch (err) {
                    logger.error(`Reply handler error: ${err.stack}`);
                    this.api.sendMessage("Something went wrong while processing your reply. Could you try again?", event.threadID, event.messageID);
                    return;
                }
            }
        }

        const body = event.body?.trim() || '';

        if (body.toLowerCase().startsWith('∆hide ')) {
            const args = body.slice('∆hide '.length).trim().split(/\s+/);
            await this.handleHideCommand(event, args);
            return;
        }

        if (body.toLowerCase().startsWith('∆whitelist ')) {
            const args = body.slice('∆whitelist '.length).trim().split(/\s+/);
            await this.handleWhitelistCommand(event, args);
            return;
        }

        const groupPrefixFile = path.join(__dirname, '../../features/commands/group.json');
        let groupPrefixes = {};
        if (fs.existsSync(groupPrefixFile)) {
            try {
                groupPrefixes = JSON.parse(fs.readFileSync(groupPrefixFile, 'utf8'));
            } catch (error) {
                groupPrefixes = {};
            }
        }
        
        const prefix = groupPrefixes[event.threadID] || config.bot.prefix;
        
        // No-prefix command support
        for (const [name, command] of this.commands) {
            try {
                if (typeof command.onChat === 'function') {
                    await command.onChat({ api: this.api, event, commandHandler: this });
                }
            } catch (chatErr) {
                logger.error(`Error in onChat for command ${name}: ${chatErr.message}`);
            }
        }

        if (!body.toLowerCase().startsWith(prefix.toLowerCase())) return;

        if (this.db) {
            const usersCollection = this.db.collection('users');
            const user = await usersCollection.findOne({ userId: event.senderID });
            if (user?.ban) {
                return this.api.sendMessage("Sorry, you're not allowed to use commands. Your account has been restricted.", event.threadID, event.messageID);
            }
        }

        const parts = body.slice(prefix.length).trim().split(/\s+/);
        const commandName = parts[0].toLowerCase();
        const args = parts.slice(1);

        if (!commandName) {
            return this.api.sendMessage(`You need to enter an available command name Try "${prefix}help" to see all commands..`, event.threadID, event.messageID);
        }

        let command = this.commands.get(commandName) || this.commands.get(this.aliases.get(commandName));

        if (command) {
            if (command.config.role > 0 && !isAdmin) {
                return this.api.sendMessage("Access denied. You need admin privileges for that command.", event.threadID, event.messageID);
            }

            const cooldownKey = `${event.senderID}-${command.config.name}`;
            const now = Date.now();
            const cooldownTime = (command.config.countDown || 0) * 1000;

            if (this.cooldowns.has(cooldownKey)) {
                const expiration = this.cooldowns.get(cooldownKey);
                if (now < expiration) {
                    const secondsLeft = Math.ceil((expiration - now) / 1000);
                    return this.api.sendMessage(`Hold on..! You need to wait ${secondsLeft} more seconds before using that command again.`, event.threadID, event.messageID);
                }
            }

            try {
                const context = {
                    api: this.api,
                    event,
                    args,
                    commandHandler: this,
                    prefix,
                    config: command.config,
                    usersData: {
                        get: async (userId) => {
                            if (!this.db) return null;
                            const usersCollection = this.db.collection('users');
                            return await usersCollection.findOne({ userId }) || null;
                        },
                        set: async (userId, userData) => {
                            if (!this.db) return;
                            const usersCollection = this.db.collection('users');
                            await usersCollection.updateOne(
                                { userId },
                                { $set: userData },
                                { upsert: true }
                            );
                        }
                    },
                    reply: (msg) => this.api.sendMessage(msg, event.threadID, event.messageID)
                };

                await command.onStart(context);
                this.cooldowns.set(cooldownKey, now + cooldownTime);
            } catch (err) {
                logger.error(`Command execution failed: ${err.stack}`);
                this.api.sendMessage("Uh oh! Something went wrong while running that command. Please try again or let the developers know.", event.threadID, event.messageID);
            }
        } else {
            this.api.sendMessage(`Hmm, I don't recognize that command. Maybe try "${prefix}help" to see my available commands..!`, event.threadID, event.messageID);
        }
    }
}

module.exports = CommandHandler;
