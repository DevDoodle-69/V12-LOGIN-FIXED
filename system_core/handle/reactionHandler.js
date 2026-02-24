const config = require('../../core_settings/config.json');
const logger = require('../logger');

class ReactionHandler {
    constructor(api) {
        this.api = api;
    }

    async handleReaction(event) {
        if (event.senderID !== config.ownerId) return;
        if (event.reaction !== '❌') return;
        if (!event.messageID) return;

        try {
            await this.api.unsendMessage(event.messageID);
            logger.info(`Message ${event.messageID} deleted by owner using ❌ reaction`);
        } catch (error) {
            logger.error(`Failed to delete message ${event.messageID}: ${error.stack}`);
        }
    }
}

module.exports = ReactionHandler;
