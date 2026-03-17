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
const https = require('https');
const EventEmitter = require('events');
const path = require('path');
const crypto = require('crypto');
const cluster = require('cluster');
const zlib = require('zlib');
const util = require('util');
const stream = require('stream');

let startTime = Date.now();
let threads = new Set();
let users = new Set();
let apiInstance;
let db;
let isStopping = false;
let keepAliveTimers = [];
let messageQueue = [];
let processingQueue = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 50;
const reconnectDelay = 5000;
let messageListeners = new Map();
let commandCooldowns = new Map();
let rateLimitTracker = new Map();
let activeDownloads = new Set();
let cacheManager = new Map();
let systemMetrics = {
    messagesProcessed: 0,
    commandsExecuted: 0,
    errorsEncountered: 0,
    apiCalls: 0,
    startTime: Date.now(),
    lastRestart: null
};

const pipeline = util.promisify(stream.pipeline);

async function getStreamFromURL(url, options = {}) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
        
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: options.timeout || 30000,
            maxContentLength: options.maxSize || 50 * 1024 * 1024,
            validateStatus: status => status >= 200 && status < 300,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                ...options.headers
            },
            signal: controller.signal,
            httpsAgent: new https.Agent({ keepAlive: true })
        });

        clearTimeout(timeout);
        
        const contentLength = response.headers['content-length'];
        if (contentLength && options.maxSize && parseInt(contentLength) > options.maxSize) {
            response.data.destroy();
            throw new Error(`File too large: ${contentLength} bytes`);
        }

        const cacheKey = crypto.createHash('md5').update(url).digest('hex');
        const cachePath = path.join(__dirname, 'cache', cacheKey);
        
        if (options.cache && fs.existsSync(cachePath)) {
            return fs.createReadStream(cachePath);
        }

        if (options.cache) {
            const writeStream = fs.createWriteStream(cachePath);
            await pipeline(response.data, writeStream);
            cacheManager.set(cacheKey, { path: cachePath, timestamp: Date.now() });
            return fs.createReadStream(cachePath);
        }

        return response.data;
    } catch (error) {
        if (error.name === 'AbortError') {
            logger.error(`Stream fetch timeout from ${url}`);
        } else {
            logger.error(`Stream fetch failed from ${url}: ${error.message}`);
        }
        return null;
    }
}

async function initializeThreadsAndUsers(api) {
    try {
        logger.info('Scanning conversation networks...');
        let threadList = [];
        let userList = [];
        
        try {
            threadList = await new Promise((resolve, reject) => {
                api.getThreadList(100, null, ["INBOX"], (err, list) => {
                    if (err) reject(err);
                    else resolve(list || []);
                });
            });
        } catch (err) {
            logger.warn(`Network scan failed: ${err.message}`);
            threadList = [];
        }

        try {
            userList = await new Promise((resolve, reject) => {
                api.getFriendsList((err, list) => {
                    if (err) reject(err);
                    else resolve(list || []);
                });
            });
        } catch (err) {
            logger.warn(`Friends list fetch failed: ${err.message}`);
            userList = [];
        }

        const usersCollection = db.collection('users');
        const threadsCollection = db.collection('threads');
        
        logger.info(`Processing ${threadList.length} pathways...`);

        for (const thread of threadList) {
            if (!thread || !thread.threadID) continue;
            threads.add(thread.threadID);
            
            try {
                await threadsCollection.updateOne(
                    { threadID: thread.threadID },
                    { 
                        $set: { 
                            threadName: thread.name || 'Unnamed',
                            lastActive: new Date(),
                            participants: thread.participants || [],
                            emoji: thread.emoji,
                            color: thread.color,
                            type: thread.isGroup ? 'group' : 'individual'
                        }
                    },
                    { upsert: true }
                );
            } catch (dbError) {
                logger.warn(`Failed to update thread ${thread.threadID} in database: ${dbError.message}`);
            }
        }

        for (const user of userList) {
            if (!user || !user.userID) continue;
            users.add(user.userID);
            
            try {
                await usersCollection.updateOne(
                    { userID: user.userID },
                    { 
                        $set: { 
                            name: user.name || 'Unknown',
                            gender: user.gender,
                            profileUrl: user.profileUrl,
                            lastActive: new Date(),
                            friendStatus: true
                        }
                    },
                    { upsert: true }
                );
            } catch (dbError) {
                logger.warn(`Failed to update user ${user.userID} in database: ${dbError.message}`);
            }
        }

        logger.info(`Network initialized: ${threads.size} pathways, ${users.size} nodes`);
        
        if (threads.size === 0) {
            logger.warn('No threads found. Attempting to join default thread...');
            try {
                const defaultThreadID = config.defaultThreadID;
                if (defaultThreadID) {
                    await new Promise((resolve, reject) => {
                        api.getThreadInfo(defaultThreadID, (err, info) => {
                            if (err) reject(err);
                            else {
                                threads.add(defaultThreadID);
                                logger.info(`Joined default thread: ${defaultThreadID}`);
                                resolve(info);
                            }
                        });
                    });
                }
            } catch (joinError) {
                logger.error(`Failed to join default thread: ${joinError.message}`);
            }
        }
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
        
        let backupFile = credFile + '.backup';
        if (fs.existsSync(credFile)) {
            fs.copyFileSync(credFile, backupFile);
        }
        
        const content = fs.readFileSync(credFile, 'utf8');
        const parsed = JSON.parse(content);
        
        if (parsed.fbstate) {
            parsed.fbstate = newState;
            if (parsed.metadata) {
                parsed.metadata.timestamp = new Date().toISOString();
                parsed.metadata.lastSave = Date.now();
            }
            fs.writeFileSync(credFile, JSON.stringify(parsed, null, 2));
        } else {
            fs.writeFileSync(credFile, JSON.stringify(newState, null, 2));
        }
        
        logger.info(`Session state saved to ${credFile}`);
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
        
        if (cacheManager.size > 100) {
            const oldest = Array.from(cacheManager.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, 50);
            
            oldest.forEach(([key, value]) => {
                try {
                    fs.unlinkSync(value.path);
                    cacheManager.delete(key);
                } catch (e) {}
            });
            logger.info(`Cache cleaned: removed ${oldest.length} items`);
        }
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
                reconnectAttempts++;
                
                if (reconnectAttempts >= maxReconnectAttempts) {
                    logger.error('Max reconnection attempts reached. Restarting bot...');
                    await stopBot();
                    setTimeout(startBot, 5000);
                }
            } else {
                reconnectAttempts = 0;
                const saved = saveStateToDisk(api, credFile);
                logger.info(`Keep-alive ping OK${saved ? ' — cookies refreshed' : ''}`);
                
                systemMetrics.apiCalls++;
            }
        } catch (e) {
            logger.warn(`Keep-alive error: ${e.message}`);
        }
    }, 4 * 60 * 60 * 1000);
    keepAliveTimers.push(pingTimer);

    const metricsTimer = setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const uptimeSeconds = process.uptime();
        
        logger.info(`System Metrics - Messages: ${systemMetrics.messagesProcessed}, Commands: ${systemMetrics.commandsExecuted}, Errors: ${systemMetrics.errorsEncountered}`);
        logger.info(`Memory - RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`);
        logger.info(`Uptime: ${getUptime()}, Queue: ${messageQueue.length}, Active Downloads: ${activeDownloads.size}`);
    }, 30 * 60 * 1000);
    keepAliveTimers.push(metricsTimer);

    logger.info('Session keep-alive started (cookie save: 1h, ping: 4h, metrics: 30m)');
}

async function processMessageQueue() {
    if (processingQueue || messageQueue.length === 0) return;
    
    processingQueue = true;
    
    while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        try {
            const { api, event, commandHandler, eventHandler } = message;
            
            if (rateLimitTracker.has(event.threadID)) {
                const lastMessage = rateLimitTracker.get(event.threadID);
                if (Date.now() - lastMessage < 1000) {
                    setTimeout(() => {
                        messageQueue.unshift(message);
                    }, 1000);
                    continue;
                }
            }
            
            rateLimitTracker.set(event.threadID, Date.now());
            
            const handled = await commandHandler.handleEvent(event);
            if (!handled) {
                await eventHandler.handleEvent(event);
            }
            
            systemMetrics.messagesProcessed++;
            
            if (event.type === 'message' || event.type === 'message_reply') {
                systemMetrics.commandsExecuted++;
            }
        } catch (error) {
            logger.error(`Error processing message: ${error.message}`);
            systemMetrics.errorsEncountered++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    processingQueue = false;
}

async function stopBot() {
    if (isStopping) return;
    isStopping = true;
    
    try {
        logger.info('V12 FCA initiating shutdown sequence...');
        
        logger.info('Clearing keep-alive timers...');
        keepAliveTimers.forEach(t => clearInterval(t));
        keepAliveTimers = [];
        
        logger.info('Processing remaining message queue...');
        if (messageQueue.length > 0) {
            await processMessageQueue();
        }
        
        logger.info('Saving final state...');
        if (apiInstance) {
            try {
                saveStateToDisk(apiInstance, global._credFile || 'v12-account.txt');
            } catch (_) {}
            apiInstance = null;
        }
        
        logger.info('Cleaning up cache...');
        for (const [key, value] of cacheManager) {
            try {
                fs.unlinkSync(value.path);
            } catch (e) {}
        }
        cacheManager.clear();
        
        logger.info('Disconnecting database...');
        if (db) {
            try {
                await require('./system_core/database').close();
                logger.info('Database disconnected');
            } catch (dbError) {
                logger.warn(`Database disconnection error: ${dbError.message}`);
            }
        }
        
        threads.clear();
        users.clear();
        messageListeners.clear();
        commandCooldowns.clear();
        rateLimitTracker.clear();
        activeDownloads.clear();
        
        systemMetrics.lastRestart = new Date();
        
        logger.info('V12 FCA shutdown complete');
        
        setTimeout(() => {
            process.exit(0);
        }, 1000);
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
        systemMetrics.startTime = startTime;

        logger.info('Creating cache directory...');
        const cacheDir = path.join(__dirname, 'cache');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

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
            logLevel: 'silent',
            online: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            pageID: config.pageID || null
        });

        global.Meta = global.Meta || {};
        global.Meta.selfListenMode = true;
        global.Meta.version = '12.0.0';
        global.Meta.buildDate = new Date().toISOString();

        logger.info('Connecting to database...');
        db = await connect();
        if (!db) throw new Error('Database connection failed');

        await initializeThreadsAndUsers(api);

        const commandHandler = new CommandHandler(api, db);
        const eventHandler = new EventHandler(api, commandHandler, db);
        const messageEvent = new MessageEvent(api, eventHandler);

        messageEvent.start(true);

        api.listenMqtt(async (err, event) => {
            if (err) {
                logger.error(`Listen error: ${err.message}`);
                if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
                    reconnectAttempts++;
                    if (reconnectAttempts < maxReconnectAttempts) {
                        logger.info(`Reconnecting... Attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
                        setTimeout(() => startBot(), reconnectDelay);
                    } else {
                        logger.error('Max reconnection attempts reached. Restarting...');
                        await stopBot();
                        setTimeout(startBot, 10000);
                    }
                }
                return;
            }

            if (!event) return;

            try {
                if (event.type === 'message' || event.type === 'message_reply') {
                    if (!users.has(event.senderID)) {
                        users.add(event.senderID);
                        try {
                            const userInfo = await new Promise((resolve) => {
                                api.getUserInfo(event.senderID, (err, info) => {
                                    if (err) resolve(null);
                                    else resolve(info);
                                });
                            });
                            
                            if (userInfo && userInfo[event.senderID]) {
                                const usersCollection = db.collection('users');
                                await usersCollection.updateOne(
                                    { userID: event.senderID },
                                    { $set: { name: userInfo[event.senderID].name, lastSeen: new Date() } },
                                    { upsert: true }
                                );
                            }
                        } catch (userError) {
                            logger.warn(`Failed to fetch user info: ${userError.message}`);
                        }
                    }

                    if (!threads.has(event.threadID)) {
                        threads.add(event.threadID);
                        try {
                            const threadInfo = await new Promise((resolve) => {
                                api.getThreadInfo(event.threadID, (err, info) => {
                                    if (err) resolve(null);
                                    else resolve(info);
                                });
                            });
                            
                            if (threadInfo) {
                                const threadsCollection = db.collection('threads');
                                await threadsCollection.updateOne(
                                    { threadID: event.threadID },
                                    { $set: { threadName: threadInfo.name || 'Unnamed', lastActive: new Date() } },
                                    { upsert: true }
                                );
                            }
                        } catch (threadError) {
                            logger.warn(`Failed to fetch thread info: ${threadError.message}`);
                        }
                    }

                    messageQueue.push({ api, event, commandHandler, eventHandler });
                    
                    if (!processingQueue) {
                        processMessageQueue();
                    }
                } else {
                    await eventHandler.handleEvent(event);
                }
            } catch (eventError) {
                logger.error(`Event handling error: ${eventError.message}`);
            }
        });

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
            },
            sendTypingIndicator: (threadId, duration = 3000) => {
                return new Promise((resolve) => {
                    apiInstance.sendTypingIndicator(threadId, (err) => {
                        if (err) {
                            logger.error(`Typing indicator error: ${err.message}`);
                            resolve(false);
                        } else {
                            setTimeout(() => {
                                apiInstance.sendTypingIndicator(threadId, true, () => {});
                                resolve(true);
                            }, duration);
                        }
                    });
                });
            },
            markAsRead: (threadId) => {
                return new Promise((resolve) => {
                    apiInstance.markAsRead(threadId, (err) => {
                        if (err) {
                            logger.error(`Mark as read error: ${err.message}`);
                            resolve(false);
                        } else {
                            resolve(true);
                        }
                    });
                });
            },
            getUserInfo: async (userId) => {
                return new Promise((resolve) => {
                    apiInstance.getUserInfo(userId, (err, info) => {
                        if (err) {
                            logger.error(`Get user info error: ${err.message}`);
                            resolve(null);
                        } else {
                            resolve(info);
                        }
                    });
                });
            },
            getThreadInfo: async (threadId) => {
                return new Promise((resolve) => {
                    apiInstance.getThreadInfo(threadId, (err, info) => {
                        if (err) {
                            logger.error(`Get thread info error: ${err.message}`);
                            resolve(null);
                        } else {
                            resolve(info);
                        }
                    });
                });
            },
            getSystemMetrics: () => {
                return {
                    ...systemMetrics,
                    uptime: getUptime(),
                    threadsCount: threads.size,
                    usersCount: users.size,
                    queueLength: messageQueue.length,
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage()
                };
            }
        };

        global.sendInbox = global.utils.sendInboxMessage;

        startSessionKeepAlive(api, selectedFile);

        logger.info(gradient.rainbow('╔══════════════════════════════════════╗'));
        logger.info(gradient.rainbow('║     V12 FCA IS NOW ONLINE            ║'));
        logger.info(gradient.rainbow('╚══════════════════════════════════════╝'));
        
        logger.info(chalk.green(`✓ System initialized in ${Date.now() - startTime}ms`));
        logger.info(chalk.cyan(`✓ Monitoring ${threads.size} threads and ${users.size} users`));
        logger.info(chalk.yellow(`✓ Web interface available on port 5904`));
        
    } catch (err) {
        logger.error(`System initialization failed: ${err.message}`);
        logger.info(`Retrying in 5 seconds... (Attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
        
        reconnectAttempts++;
        if (reconnectAttempts < maxReconnectAttempts) {
            setTimeout(startBot, reconnectDelay);
        } else {
            logger.error('Max initialization attempts reached. Exiting...');
            process.exit(1);
        }
    }
}

const webServer = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
                <head>
                    <title>V12 FCA Status</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: Arial; background: #1a1a1a; color: #fff; padding: 20px; }
                        .status { background: #2d2d2d; padding: 20px; border-radius: 10px; }
                        .online { color: #00ff00; }
                        .metric { margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <div class="status">
                        <h1>V12 FCA Status</h1>
                        <div class="metric">Status: <span class="online">ONLINE</span></div>
                        <div class="metric">Uptime: ${getUptime()}</div>
                        <div class="metric">Threads: ${threads.size}</div>
                        <div class="metric">Users: ${users.size}</div>
                        <div class="metric">Messages Processed: ${systemMetrics.messagesProcessed}</div>
                        <div class="metric">Commands Executed: ${systemMetrics.commandsExecuted}</div>
                        <div class="metric">Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB</div>
                        <div class="metric">Queue: ${messageQueue.length}</div>
                    </div>
                </body>
            </html>
        `);
    } else if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            uptime: getUptime(),
            threads: threads.size,
            users: users.size,
            metrics: systemMetrics,
            memory: process.memoryUsage(),
            queue: messageQueue.length,
            timestamp: new Date().toISOString()
        }));
    } else if (req.url === '/api/restart' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'restarting' }));
        stopBot().then(() => {
            setTimeout(startBot, 3000);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

webServer.listen(5904, '0.0.0.0', () => {
    logger.info(`Web server running on port 5904`);
});

webServer.on('error', (err) => {
    logger.error(`Web server error: ${err.message}`);
});

logger.displayStartupBanner();

if (cluster.isMaster && config.clusterMode) {
    const numWorkers = require('os').cpus().length;
    logger.info(`Starting ${numWorkers} worker processes...`);
    
    for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker) => {
        logger.warn(`Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });
} else {
    startBot();
}

async function handleExit(signal) {
    logger.info(`Signal ${signal} received, initiating shutdown...`);
    await stopBot();
}

process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));
process.on('SIGQUIT', () => handleExit('SIGQUIT'));

process.on('uncaughtException', (err) => {
    if (!err) return;
    const msg = err instanceof Error ? err.stack : String(err);
    logger.error(`Uncaught exception: ${msg}`);
    systemMetrics.errorsEncountered++;
    
    if (err.code === 'EADDRINUSE') {
        logger.error('Port 5904 already in use. Attempting to continue...');
    } else if (err.code === 'ECONNREFUSED') {
        logger.warn('Connection refused. Will retry automatically.');
    } else {
        logger.info('Attempting to recover...');
    }
});

process.on('unhandledRejection', (reason) => {
    if (reason === undefined || reason === null) return;
    if (reason && reason.code === 'ECONNRESET') return;
    if (reason && reason.code === 'ETIMEDOUT') return;
    
    const msg = reason instanceof Error ? reason.stack : (typeof reason === 'object' ? JSON.stringify(reason) : String(reason));
    if (!msg || msg === 'undefined' || msg === 'null') return;
    
    logger.warn(`Unhandled promise rejection: ${msg}`);
    systemMetrics.errorsEncountered++;
});

setInterval(() => {
    const now = Date.now();
    for (const [userId, cooldown] of commandCooldowns) {
        if (now > cooldown) {
            commandCooldowns.delete(userId);
        }
    }
    
    for (const [threadId, timestamp] of rateLimitTracker) {
        if (now - timestamp > 60000) {
            rateLimitTracker.delete(threadId);
        }
    }
}, 60000);

process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning') return;
    logger.warn(`Process warning: ${warning.message}`);
});

if (!fs.existsSync('./logs')) {
    fs.mkdirSync('./logs', { recursive: true });
}

const logStream = fs.createWriteStream('./logs/system.log', { flags: 'a' });
process.stdout.write = (function(write) {
    return function(string, encoding, fd) {
        logStream.write(string);
        write.apply(process.stdout, arguments);
    };
})(process.stdout.write);

process.stderr.write = (function(write) {
    return function(string, encoding, fd) {
        logStream.write(string);
        write.apply(process.stderr, arguments);
    };
})(process.stderr.write);
