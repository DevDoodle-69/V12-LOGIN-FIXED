const logger = require('../../system_core/logger');
const config = require('../../core_settings/config.json');
class MessageEvent {
  constructor(api, eventHandler) {
    this.api = api;
    this.eventHandler = eventHandler;
    this.retryCount = 0;
    this.maxRetries = config.retries.maxRetries;
    this.retryDelay = config.retries.retryDelay;
  }

  start(useMqtt = true) {
    logger.info(`${config.bot.botName}: Startup complete!`);
    const listener = useMqtt ? this.api.listenMqtt : this.api.listen;
    logger.info(`Starting ${useMqtt ? 'MQTT' : 'non-MQTT'} listener...`);

    listener(async (err, event) => {
      if (err) {
        logger.error(`Listener error (${useMqtt ? 'MQTT' : 'non-MQTT'}): ${err.message}`);
        // ... retry logic
        return;
      }

      logger.verbose(`Received event: ${JSON.stringify(event, null, 2)}`);

      await this.eventHandler.handleEvent(event);
    });
  }
}

module.exports = MessageEvent;