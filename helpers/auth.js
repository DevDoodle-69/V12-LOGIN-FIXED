const fs = require('fs');
const login = require('../V12-FCA/index');
const logger = require('../system_core/logger');
const config = require('../core_settings/config.json');

async function authenticate() {
  let appState;
  const accountFiles = ['v12-account.txt', 'v12-account-v2.txt', 'appstate.json'];
  let selectedFile = 'appstate.json';

  for (const file of accountFiles) {
    try {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(content);
        
        if (parsed.fbstate && Array.isArray(parsed.fbstate)) {
          appState = parsed.fbstate;
          logger.info(`Successfully loaded credentials from ${file} (fbstate format)`);
        } else if (Array.isArray(parsed)) {
          appState = parsed;
          logger.info(`Successfully loaded credentials from ${file} (array format)`);
        }
        
        if (appState) {
          selectedFile = file;
          logger.info(`Active credentials file: ${file}`);
          break;
        }
      }
    } catch (err) {
      logger.error(`Failed to parse ${file}: ${err.message}`);
    }
  }

  const loginData = {
    appState,
    email: config.bot.login.username,
    password: config.bot.login.password
  };

  const options = {
    forceLogin: config.bot.forceLogin,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  };

  return new Promise((resolve) => {
    login(loginData, options, (err, api) => {
      if (err) {
        logger.error(`Login failed: ${err.message || err}`);
        resolve(null);
        return;
      }
      
      try {
        const newState = api.getAppState();
        if (selectedFile === 'v12-account.txt' || selectedFile === 'v12-account-v2.txt') {
          const original = JSON.parse(fs.readFileSync(selectedFile, 'utf8'));
          if (original.fbstate) {
            original.fbstate = newState;
            if (original.metadata) original.metadata.timestamp = new Date().toISOString();
            fs.writeFileSync(selectedFile, JSON.stringify(original, null, 2));
          } else {
            fs.writeFileSync(selectedFile, JSON.stringify(newState, null, 2));
          }
        } else {
          fs.writeFileSync(selectedFile, JSON.stringify(newState, null, 2));
        }
      } catch (e) {
        logger.warn(`Failed to save refreshed appstate to ${selectedFile}: ${e.message}`);
      }
      
      logger.info('Authenticated successfully');
      resolve(api);
    });
  });
}

module.exports = { authenticate };
