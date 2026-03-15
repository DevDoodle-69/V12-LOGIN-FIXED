const logger = require('../../system_core/logger');
const config = require('../../core_settings/config.json');

class MessageEvent {
  constructor(api, eventHandler) {
    this.api = api;
    this.eventHandler = eventHandler;
    this.retryCount = 0;
    this.maxRetries = (config.retries && config.retries.maxRetries) || 10;
    this.retryDelay = (config.retries && config.retries.retryDelay) || 5000;
    this.useMqtt = true;
    this._stopped = false;
    this._retryTimer = null;
  }

  start(useMqtt = true) {
    this.useMqtt = useMqtt;
    this._stopped = false;
    logger.info(`${config.bot.botName}: Startup complete!`);

    const listenerFn = useMqtt ? this.api.listenMqtt : this.api.listen;
    if (typeof listenerFn !== 'function') {
      logger.error(`Listener function not available (${useMqtt ? 'listenMqtt' : 'listen'})`);
      return;
    }

    logger.info(`Starting ${useMqtt ? 'MQTT' : 'standard'} listener...`);

    listenerFn(async (err, event) => {
      if (err) {
        if (this._stopped) return;

        const errType = err.type || '';
        const errMsg = err.error || err.message || JSON.stringify(err);

        if (errType === 'stop_listen' || errMsg.includes('stop_listen') || errMsg.includes('CONNACK')) {
          logger.warn(`Connection dropped: ${errMsg} — scheduling reconnect...`);
          this._scheduleReconnect();
          return;
        }

        if (errType === 'parse_error') return;

        logger.error(`Listener error: ${errMsg}`);
        return;
      }

      this.retryCount = 0;

      try {
        await this.eventHandler.handleEvent(event);
      } catch (handlerErr) {
        logger.error(`Event handler error: ${handlerErr.message || handlerErr}`);
      }
    });
  }

  _scheduleReconnect() {
    if (this._stopped || this._retryTimer) return;

    if (this.retryCount >= this.maxRetries) {
      logger.error(`Max reconnect attempts (${this.maxRetries}) reached — giving up`);
      return;
    }

    const backoff = Math.min(this.retryDelay * Math.pow(1.5, this.retryCount), 60000);
    this.retryCount++;

    logger.info(`Reconnect attempt ${this.retryCount}/${this.maxRetries} in ${Math.round(backoff / 1000)}s...`);

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this._stopped) {
        this.start(this.useMqtt);
      }
    }, backoff);
  }

  stop() {
    this._stopped = true;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }
}

module.exports = MessageEvent;
