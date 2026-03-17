const logger = require('./system_core/logger');
const fetch = require('node-fetch');
const { authenticate } = require('./helpers/auth');
const CommandHandler = require('./system_core/controllers/commandHandler');
const EventHandler = require('./system_core/handle/eventHandler');
const MessageEvent = require('./features/events/message');
const gradient = require('gradient-string');
const chalk = require('chalk');
const config = require('./core_settings/config.json');
const axios = require('axios');
const { connect } = require('./system_core/database/index');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const http = require('http');
const EventEmitter = require('events');

let startTime = Date.now();
let threads = new Set();
let users = new Set();
let apiInstance;
let db;
let isStopping = false;
let keepAliveTimers = [];

async function getStreamFromURL(url) {
    try {
        const response = await axios({ method: 'GET', url, responseType: 'stream' });
        return response.data;
    } catch (error) {
        logger.error(`Stream fetch failed from ${url}: ${error.message}`);
        return null;
    }
}

async function initializeThreadsAndUsers(api) {
    try {
        logger.info('Scanning conversation networks...');
        let threadList = [];
        try {
            threadList = await new Promise((resolve) => {
                api.getThreadList(20, null, ["INBOX"], (err, list) => {
                    if (err) resolve([]);
                    else resolve(list || []);
                });
            });
        } catch (err) {
            logger.warn(`Network scan failed: ${err.message}`);
            threadList = [];
        }

        const usersCollection = db.collection('users');
        logger.info(`Processing ${threadList.length} pathways...`);

        for (const thread of threadList) {
            if (!thread || !thread.threadID) continue;
            threads.add(thread.threadID);
        }

        logger.info(`Network initialized: ${threads.size} pathways, ${users.size} nodes`);
    } catch (err) {
        logger.error(`Network initialization failed: ${err.message}`);
        threads = new Set();
        users = new Set();
    }
}

function getUptime() {
    let uptime = Date.now() - startTime;
    let seconds = Math.floor((uptime / 1000) % 60);
    let minutes = Math.floor((uptime / (1000 * 60)) % 60);
    let hours = Math.floor((uptime / (1000 * 60 * 60)) % 24);
    let days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function saveStateToDisk(api, credFile) {
    try {
        const newState = api.getAppState();
        if (!newState || newState.length === 0) return false;
        const content = fs.readFileSync(credFile, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.fbstate) {
            parsed.fbstate = newState;
            if (parsed.metadata) parsed.metadata.timestamp = new Date().toISOString();
            fs.writeFileSync(credFile, JSON.stringify(parsed, null, 2));
        } else {
            fs.writeFileSync(credFile, JSON.stringify(newState, null, 2));
        }
        return true;
    } catch (e) {
        logger.warn(`Cookie save failed: ${e.message}`);
        return false;
    }
}

function startSessionKeepAlive(api, credFile) {
    keepAliveTimers.forEach(t => clearInterval(t));
    keepAliveTimers = [];

    const cookieSaveTimer = setInterval(() => {
        const saved = saveStateToDisk(api, credFile);
        if (saved) logger.info('Session cookies auto-saved to disk');
    }, 60 * 60 * 1000);
    keepAliveTimers.push(cookieSaveTimer);

    const pingTimer = setInterval(async () => {
        try {
            const result = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 30000);
                api.getThreadList(1, null, ["INBOX"], (err, list) => {
                    clearTimeout(timeout);
                    resolve(err ? null : list);
                });
            });

            if (result === null) {
                logger.warn('Keep-alive ping failed — session may have expired');
            } else {
                const saved = saveStateToDisk(api, credFile);
                logger.info(`Keep-alive ping OK${saved ? ' — cookies refreshed' : ''}`);
            }
        } catch (e) {
            logger.warn(`Keep-alive error: ${e.message}`);
        }
    }, 4 * 60 * 60 * 1000);
    keepAliveTimers.push(pingTimer);

    logger.info('Session keep-alive started (cookie save: 1h, ping: 4h)');
}

async function stopBot() {
    if (isStopping) return;
    isStopping = true;
    try {
        logger.info('V12 FCA initiating shutdown sequence...');
        keepAliveTimers.forEach(t => clearInterval(t));
        keepAliveTimers = [];
        if (apiInstance) {
            try { saveStateToDisk(apiInstance, global._credFile || 'v12-account.txt'); } catch (_) {}
            apiInstance = null;
        }
        if (db) {
            await require('./system_core/database').close();
            logger.info('Database disconnected');
        }
        threads.clear();
        users.clear();
        logger.info('V12 FCA shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error(`Shutdown sequence failed: ${err.message}`);
        process.exit(1);
    } finally {
        isStopping = false;
    }
}

async function startBot() {
    try {
        logger.info('Initializing V12 FCA systems...');
        startTime = Date.now();

        logger.info('Authenticating interface with v12-account.txt...');
        const authResult = await authenticate();
        if (!authResult) throw new Error('Authentication failed - verify v12-account.txt or config.json credentials');

        const { api, selectedFile } = authResult;
        global._credFile = selectedFile;
        apiInstance = api;

        api.setOptions({
            listenEvents: true,
            selfListen: true,
            forceLogin: true,
            autoReconnect: true,
            logLevel: 'silent'
        });

        global.Meta = global.Meta || {};
        global.Meta.selfListenMode = true;

        logger.info('Connecting to database...');
        db = await connect();
        if (!db) throw new Error('Database connection failed');

        await initializeThreadsAndUsers(api);

        const commandHandler = new CommandHandler(api, db);
        const eventHandler = new EventHandler(api, commandHandler, db);
        const messageEvent = new MessageEvent(api, eventHandler);
        messageEvent.start(true);

        global.utils = {
            getStreamFromURL,
            sendInboxMessage: async (userId, message, attachments = null) => {
                try {
                    if (!apiInstance) throw new Error('API not initialized');
                    return await new Promise((resolve, reject) => {
                        const callback = (err, info) => {
                            if (err) {
                                logger.error(`Failed to send inbox message to ${userId}: ${err.message}`);
                                return reject(err);
                            }
                            logger.info(`Inbox message sent to ${userId}`);
                            resolve(info);
                        };
                        if (attachments) {
                            const attachmentArray = Array.isArray(attachments) ? attachments : [attachments];
                            apiInstance.sendMessage({ body: message, attachment: attachmentArray }, userId, callback);
                        } else {
                            apiInstance.sendMessage(message, userId, callback);
                        }
                    });
                } catch (err) {
                    logger.error(`sendInboxMessage error: ${err.message}`);
                    throw err;
                }
            }
        };
        global.sendInbox = global.utils.sendInboxMessage;

        startSessionKeepAlive(api, selectedFile);

        logger.info('V12 FCA is now online and operational!');
    } catch (err) {
        logger.error(`System initialization failed: ${err.message}`);
        setTimeout(startBot, 5000);
    }
}

const webServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});
webServer.listen(5904, '0.0.0.0', () => {
    logger.info('Web server running on port 5904');
});

logger.displayStartupBanner();
startBot();

async function handleExit(signal) {
    logger.info(`Signal ${signal} received, initiating shutdown...`);
    await stopBot();
}

process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));

process.on('uncaughtException', (err) => {
    if (!err) return;
    const msg = err instanceof Error ? err.stack : String(err);
    logger.error(`Uncaught exception: ${msg}`);
});

process.on('unhandledRejection', (reason) => {
    if (reason === undefined || reason === null) return;
    if (reason && reason.code === 'ECONNRESET') return;
    const msg = reason instanceof Error ? reason.stack : (typeof reason === 'object' ? JSON.stringify(reason) : String(reason));
    if (!msg || msg === 'undefined' || msg === 'null') return;
    logger.warn(`Unhandled promise rejection: ${msg}`);
});

setInterval(() => {}, 1000 * 60 * 60 * 24 * 7);
