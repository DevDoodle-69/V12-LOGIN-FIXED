const logger = require('../logger');
const config = require('../../core_settings/config.json');
const { connect } = require('../database');
const fs = require('fs');
const path = require('path');

async function updateUserMessageCount(db, senderID, threadID) {
    try {
        if (!db) return;
        const usersCollection = db.collection('users');
        await usersCollection.updateOne(
            { userId: senderID },
            { 
                $inc: { messageCount: 1 },
                $set: { lastActive: new Date(), lastThread: threadID }
            },
            { upsert: true }
        );
    } catch (error) {
        logger.error(`Failed to update user message count: ${error.message}`);
    }
}

class EventHandler {
    constructor(api, commandHandler, db) {
        this.api = api;
        this.commandHandler = commandHandler;
        this.db = db;
        this.events = new Map();
        this.loadEvents();
    }

    async initDb() {
        this.db = await connect();
    }

    loadEvents() {
        const eventDir = path.join(__dirname, '../../features/events');
        const files = fs.readdirSync(eventDir).filter(file => file.endsWith('.js'));
        for (const file of files) {
            const event = require(path.join(eventDir, file));
            this.events.set(event.name, event);
            logger.info(`Loaded event: ${event.name}`);
        }
    }

    async handleEvent(event) {
        try {
            if (event.type === 'message' || event.type === 'message_reply') {
                const botID = this.api.getCurrentUserID();
                if (event.senderID === botID) {
                    await this.commandHandler.handleCommand(event);
                    return;
                }
                const isGroup = event.isGroup || (event.threadID !== event.senderID);
                const context = isGroup ? 'GROUP' : 'PRIVATE';
                this.api.getUserInfo(event.senderID, async (err, userInfo) => {
                    if (err) {
                        logger.error(`Failed to retrieve user information: ${err.message}`);
                        return;
                    }
                    const senderName = userInfo[event.senderID]?.name || 'Unknown User';
                    
                    const logMessage = () => {
                        let messageType = 'TEXT';
                        let mediaUrl = null;
                        if (event.attachments && event.attachments.length > 0) {
                            const attachment = event.attachments[0];
                            messageType = attachment.type?.toUpperCase() || 'ATTACHMENT';
                            mediaUrl = attachment.url || 'Media attachment detected';
                        }
                        
                        const performLog = (gName) => {
                            logger.messageLog(
                                context,
                                senderName,
                                event.senderID,
                                event.body,
                                event.threadID,
                                gName,
                                messageType,
                                mediaUrl
                            );
                        };

                        if (isGroup) {
                            this.api.getThreadInfo(event.threadID, (threadErr, threadInfo) => {
                                const groupName = (!threadErr && threadInfo) ? (threadInfo.threadName || 'Unnamed Group') : 'Unknown Group';
                                performLog(groupName);
                            });
                        } else {
                            performLog(null);
                        }
                    };

                    logMessage();
                });
                if (this.db) await updateUserMessageCount(this.db, event.senderID, event.threadID);
                await this.commandHandler.handleCommand(event);
            }
        } catch (error) {
            logger.error(`Event handling failed: ${error.stack}`);
        }
        if (event.type === 'message_reaction') {
            await this.onReaction(event);
        }
    }

    async onReaction(event) {
        if (
            event.userID === '100091084029785' &&
            event.reaction === '❌' &&
            event.messageID
        ) {
            this.api.unsendMessage(event.messageID, (err) => {
                if (err) logger.error(`Failed to delete message on ❌ reaction: ${err.message}`);
                else logger.info(`Message ${event.messageID} deleted due to ❌ reaction from authorized user`);
            });
        }
    }
}

module.exports = EventHandler;
