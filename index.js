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
            // Skip detailed thread info fetch to avoid potential crashes in getThreadInfo
            // Users will be added to DB when they send messages
        }
        
        logger.info(`Network initialized: ${threads.size} pathways, ${users.size} nodes`);
    } catch (err) {
        logger.error(`[ERROR] Network initialization failed: ${err.message}`);
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

async function stopBot() {
    if (isStopping) return;
    isStopping = true;
    try {
        logger.info('V12 FCA initiating shutdown sequence...');
        if (apiInstance) apiInstance = null;
        if (db) {
            await require('./system_core/database').close();
            logger.info('Database disconnected');
        }
        threads.clear();
        users.clear();
        logger.info('V12 FCA shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error(`[ERROR] Shutdown sequence failed: ${err.message}`);
        process.exit(1);
    } finally {
        isStopping = false;
    }
}

async function startBot() {
    try {
        logger.info('Initializing V12 FCA systems...');
        startTime = Date.now();

        logger.info('Authenticating interface...');
        const api = await authenticate();
        if (!api) throw new Error('Authentication failed');
        apiInstance = api;
        api.setOptions({ listenEvents: true, selfListen: true, forceLogin: true, autoReconnect: true, logLevel: 'silent' });
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
        global.utils = { getStreamFromURL, sendInboxMessage: async (userId, message, attachments = null) => {
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
        } };
        global.sendInbox = global.utils.sendInboxMessage;
        logger.info('V12 FCA is now online and operational!');
    } catch (err) {
        logger.error(`[ERROR] System initialization failed: ${err.message}`);
        setTimeout(startBot, 5000); // Retry on failure
    }
}

logger.displayStartupBanner();
startBot();

async function handleExit(signal) {
    logger.info(`[WARNING] Signal ${signal} received, initiating emergency shutdown...`);
    await stopBot();
}

['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].forEach(signal => {
    process.on(signal, async (err) => {
        if (signal === 'uncaughtException' || signal === 'unhandledRejection') {
            const errorMsg = err instanceof Error ? err.stack : JSON.stringify(err, null, 2);
            logger.error(`[CRITICAL] System error: ${errorMsg}`);
            // Don't exit on unhandled errors, just log them
            if (signal === 'unhandledRejection' || signal === 'uncaughtException') return;
        }
        await handleExit(signal);
    });
});

setInterval(() => {}, 1000 * 60 * 60 * 24 * 7);
