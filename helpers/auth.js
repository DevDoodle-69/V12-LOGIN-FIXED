const login = require('../V12-FCA/index');
const config = require('../core_settings/config.json');
const logger = require('../system_core/logger');

async function authenticate() {
    return new Promise((resolve, reject) => {
        const loginData = {
            email: config.bot.login.username,
            password: config.bot.login.password
        };
        
        const options = {
            logLevel: 'silent',
            forceLogin: true,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        };

        login(loginData, options, (err, api) => {
            if (err) {
                logger.error(`Authentication failed: ${err.message}`);
                return resolve(null);
            }
            logger.info('Authentication successful!');
            resolve(api);
        });
    });
}

module.exports = { authenticate };
