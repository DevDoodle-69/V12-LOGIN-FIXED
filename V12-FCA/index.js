"use strict";

const utils = require("./utils");
const cheerio = require("cheerio");
const log = require("npmlog");
log.level = 'error';
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { TOTP } = require("totp-generator");
const qs = require('querystring');
const https = require('https');
const http = require('http');
const EventEmitter = require('events');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const zlib = require('zlib');

const Boolean_Option = ['online', 'selfListen', 'listenEvents', 'updatePresence', 'forceLogin', 'autoMarkDelivery', 'autoMarkRead', 'listenTyping', 'autoReconnect', 'emitReady'];
global.ditconmemay = false;

class CookieManager {
    static getDefaultExpiry() {
        const d = new Date();
        d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
        return d.toUTCString();
    }

    static fixCookieExpiry(appState) {
        if (!appState || !Array.isArray(appState)) return appState;
        return appState.map(c => {
            if (!c.expires || isNaN(new Date(c.expires).getTime())) {
                c.expires = this.getDefaultExpiry();
            }
            return c;
        });
    }

    static mergeCookies(existing, fresh) {
        const merged = [...existing];
        fresh.forEach(newCookie => {
            const index = merged.findIndex(c => c.key === newCookie.key && c.domain === newCookie.domain);
            if (index >= 0) merged[index] = newCookie;
            else merged.push(newCookie);
        });
        return merged;
    }
}

class DeviceManager {
    constructor(persistentPath = null) {
        this.persistentPath = persistentPath;
        this.devicePool = [];
        this.currentDevice = null;
        this.loadDevices();
    }

    loadDevices() {
        this.devicePool = [
            { model: "Pixel 8 Pro", build: "UQ1A.240205.002", release: "14", manufacturer: "Google" },
            { model: "SM-S918U", build: "UP1A.231005.007", release: "14", manufacturer: "Samsung" },
            { model: "iPhone15,3", build: "21A329", release: "17.0", manufacturer: "Apple", isIOS: true },
            { model: "iPhone16,1", build: "21B91", release: "17.2", manufacturer: "Apple", isIOS: true },
            { model: "Pixel 7", build: "TQ3A.230901.001", release: "13", manufacturer: "Google" },
            { model: "2211133G", build: "TP1A.220624.014", release: "13", manufacturer: "Xiaomi" },
            { model: "CPH2449", build: "TP1A.220624.014", release: "13", manufacturer: "OnePlus" },
            { model: "V2230", build: "TP1A.220624.014", release: "13", manufacturer: "Vivo" }
        ];

        if (this.persistentPath && fs.existsSync(this.persistentPath)) {
            try {
                this.currentDevice = JSON.parse(fs.readFileSync(this.persistentPath, 'utf8'));
            } catch (e) {}
        }
    }

    getRandomDevice() {
        if (this.currentDevice) return this.currentDevice;

        const device = this.devicePool[Math.floor(Math.random() * this.devicePool.length)];
        let userAgent;

        if (device.isIOS) {
            userAgent = `Facebook/447.0.0.35.111 (iOS; ${device.release}; ${device.model})`;
        } else {
            userAgent = `Dalvik/2.1.0 (Linux; U; Android ${device.release}; ${device.model} Build/${device.build})`;
        }

        const profile = {
            userAgent,
            deviceId: uuidv4(),
            familyDeviceId: uuidv4(),
            manufacturer: device.manufacturer,
            model: device.model,
            osVersion: device.release,
            isIOS: device.isIOS || false
        };

        if (this.persistentPath) {
            this.currentDevice = profile;
            fs.writeFileSync(this.persistentPath, JSON.stringify(profile, null, 2));
        }

        return profile;
    }

    rotateDevice() {
        this.currentDevice = null;
        if (this.persistentPath && fs.existsSync(this.persistentPath)) {
            fs.unlinkSync(this.persistentPath);
        }
        return this.getRandomDevice();
    }
}

class SessionManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.dataDir = options.dataDir || process.cwd();
        this.appstatePath = options.appstatePath || path.join(this.dataDir, 'appstate.json');
        this.credentialsPath = options.credentialsPath || path.join(this.dataDir, 'credentials.json');
        this.backupPath = options.backupPath || path.join(this.dataDir, 'backups');
        this.sessionDbPath = options.sessionDbPath || path.join(this.dataDir, 'session.db');
        this.maxBackups = options.maxBackups || 10;
        this.autoBackup = options.autoBackup !== false;
        this.encryptionKey = options.encryptionKey || null;

        this.deviceManager = new DeviceManager(options.persistentDevicePath || path.join(this.dataDir, 'device.json'));
        this.db = null;
        this.initDatabase();
        this.ensureDirectories();
        this.pruneOldBackups();
    }

    initDatabase() {
        try {
            this.db = new sqlite3.Database(this.sessionDbPath);
            this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                appstate TEXT,
                created_at INTEGER,
                last_used INTEGER,
                metadata TEXT
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS cookies (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                name TEXT,
                value TEXT,
                domain TEXT,
                path TEXT,
                expires INTEGER,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )`);

            this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
        } catch (e) {
            console.error('Failed to initialize session database:', e.message);
        }
    }

    ensureDirectories() {
        try {
            const dirs = [this.backupPath, path.dirname(this.appstatePath), path.dirname(this.sessionDbPath)];
            dirs.forEach(dir => {
                if (dir && !fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            });
        } catch (e) {}
    }

    pruneOldBackups() {
        if (!this.autoBackup) return;
        try {
            if (!fs.existsSync(this.backupPath)) return;
            const files = fs.readdirSync(this.backupPath)
                .filter(f => f.startsWith('appstate_') && f.endsWith('.json'))
                .map(f => ({ name: f, path: path.join(this.backupPath, f), mtime: fs.statSync(path.join(this.backupPath, f)).mtime.getTime() }))
                .sort((a, b) => b.mtime - a.mtime);

            if (files.length > this.maxBackups) {
                files.slice(this.maxBackups).forEach(f => fs.unlinkSync(f.path));
            }
        } catch (e) {}
    }

    encrypt(data) {
        if (!this.encryptionKey) return data;
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(this.encryptionKey).digest(), iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return { iv: iv.toString('hex'), data: encrypted.toString('hex'), authTag: authTag.toString('hex') };
    }

    decrypt(encryptedData) {
        if (!this.encryptionKey || !encryptedData.iv) return encryptedData;
        try {
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const authTag = Buffer.from(encryptedData.authTag, 'hex');
            const encrypted = Buffer.from(encryptedData.data, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(this.encryptionKey).digest(), iv);
            decipher.setAuthTag(authTag);
            return JSON.parse(decipher.update(encrypted, 'binary', 'utf8') + decipher.final('utf8'));
        } catch (e) {
            return null;
        }
    }

    loadAppstate() {
        try {
            if (!fs.existsSync(this.appstatePath)) return null;
            const raw = JSON.parse(fs.readFileSync(this.appstatePath, 'utf8'));
            let appstate = this.decrypt(raw);
            if (!appstate) appstate = raw;
            return CookieManager.fixCookieExpiry(appstate);
        } catch (error) {
            return null;
        }
    }

    saveAppstate(appstate, metadata = {}) {
        try {
            const fixedAppstate = CookieManager.fixCookieExpiry(appstate);
            let dataToSave = fixedAppstate;
            if (this.encryptionKey) {
                dataToSave = this.encrypt(fixedAppstate);
            }

            fs.writeFileSync(this.appstatePath, JSON.stringify(dataToSave, null, 2));

            const userId = fixedAppstate.find(c => c.key === 'c_user')?.value || 'unknown';
            const timestamp = Date.now();

            if (this.db) {
                const sessionId = uuidv4();
                this.db.run('INSERT OR REPLACE INTO sessions (id, user_id, appstate, created_at, last_used, metadata) VALUES (?, ?, ?, ?, ?, ?)',
                    [sessionId, userId, JSON.stringify(fixedAppstate), timestamp, timestamp, JSON.stringify(metadata)]);

                fixedAppstate.forEach(cookie => {
                    const cookieId = uuidv4();
                    this.db.run('INSERT OR REPLACE INTO cookies (id, session_id, name, value, domain, path, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [cookieId, sessionId, cookie.key, cookie.value, cookie.domain || '.facebook.com', cookie.path || '/', new Date(cookie.expires).getTime() || 0]);
                });
            }

            if (this.autoBackup) {
                const backupName = `appstate_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
                const backupPath = path.join(this.backupPath, backupName);
                fs.writeFileSync(backupPath, JSON.stringify({ appstate: fixedAppstate, metadata, timestamp }, null, 2));
                this.pruneOldBackups();
            }

            return true;
        } catch (error) {
            console.error('Failed to save appstate:', error.message);
            return false;
        }
    }

    hasValidAppstate() {
        try {
            if (!fs.existsSync(this.appstatePath)) return false;
            const appstate = this.loadAppstate();
            if (!appstate || !Array.isArray(appstate)) return false;

            const cUser = appstate.find(c => c.key === 'c_user');
            const xs = appstate.find(c => c.key === 'xs');
            const datr = appstate.find(c => c.key === 'datr');

            if (!cUser || !xs || !datr) return false;

            const expiryCheck = appstate.some(c => c.expires && new Date(c.expires).getTime() > Date.now());
            return expiryCheck;
        } catch (error) {
            return false;
        }
    }

    getUserId() {
        const appstate = this.loadAppstate();
        if (!appstate) return null;
        return appstate.find(c => c.key === 'c_user')?.value || null;
    }

    async verifySession(api) {
        try {
            const result = await api.getUserInfo(this.getUserId());
            return result && Object.keys(result).length > 0;
        } catch (e) {
            return false;
        }
    }
}

class APIResponseCache {
    constructor(maxSize = 100, ttl = 300000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        return item.value;
    }

    set(key, value) {
        if (this.cache.size >= this.maxSize) {
            const oldest = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) this.cache.delete(oldest[0]);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    clear() {
        this.cache.clear();
    }

    invalidate(key) {
        this.cache.delete(key);
    }
}

class MQTTManager extends EventEmitter {
    constructor(ctx, api) {
        super();
        this.ctx = ctx;
        this.api = api;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.keepAliveInterval = null;
        self.listenMqtt = true;
    }

    connect() {
        if (!this.ctx.mqttEndpoint) {
            this.emit('error', new Error('No MQTT endpoint available'));
            return;
        }

        try {
            const endpoint = this.ctx.mqttEndpoint.replace(/^mqtts?:\/\//, 'wss://');
            this.ws = new WebSocket(endpoint, {
                headers: {
                    'Cookie': this.ctx.jar.getCookieString('https://www.facebook.com'),
                    'User-Agent': this.ctx.globalOptions.userAgent
                }
            });

            this.ws.on('open', () => {
                this.reconnectAttempts = 0;
                this.emit('connected');
                this.sendConnectPacket();
                this.startKeepAlive();
            });

            this.ws.on('message', (data) => this.handleMessage(data));
            this.ws.on('error', (err) => this.emit('error', err));
            this.ws.on('close', () => this.handleDisconnect());
        } catch (err) {
            this.emit('error', err);
        }
    }

    sendConnectPacket() {
        const packet = this.buildConnectPacket();
        this.ws.send(packet);
    }

    buildConnectPacket() {
        const buffer = Buffer.alloc(256);
        let offset = 0;
        buffer.writeUInt8(0x10, offset++);
        const remainingLength = 50;
        buffer.writeUInt8(remainingLength, offset++);
        buffer.write('MQTT', offset, 'utf8'); offset += 4;
        buffer.writeUInt8(0x04, offset++);
        buffer.writeUInt8(0x02, offset++);
        buffer.writeUInt16BE(60, offset); offset += 2;
        return buffer.slice(0, offset);
    }

    startKeepAlive() {
        this.keepAliveInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const ping = Buffer.from([0xC0, 0x00]);
                this.ws.send(ping);
            }
        }, 30000);
    }

    handleMessage(data) {
        try {
            if (data[0] === 0xD0) return;
            this.emit('message', data);
        } catch (err) {
            this.emit('error', err);
        }
    }

    handleDisconnect() {
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            setTimeout(() => this.connect(), delay);
        } else {
            this.emit('max_reconnect');
        }
    }

    disconnect() {
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

class RequestQueue {
    constructor(maxConcurrent = 5, rateLimit = 50) {
        this.queue = [];
        this.running = 0;
        this.maxConcurrent = maxConcurrent;
        this.rateLimit = rateLimit;
        this.requestsThisMinute = 0;
        this.resetInterval = setInterval(() => { this.requestsThisMinute = 0; }, 60000);
    }

    async add(fn) {
        if (this.running >= this.maxConcurrent || this.requestsThisMinute >= this.rateLimit) {
            await new Promise(resolve => this.queue.push(resolve));
        }

        this.running++;
        this.requestsThisMinute++;

        try {
            return await fn();
        } finally {
            this.running--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        }
    }

    destroy() {
        clearInterval(this.resetInterval);
    }
}

class ErrorHandler {
    static isCheckpointError(error) {
        const msg = error.message || '';
        return msg.includes('checkpoint') || msg.includes('block') || msg.includes('review');
    }

    static isRateLimitError(error) {
        return error.statusCode === 429 || (error.message && error.message.includes('rate limit'));
    }

    static isNetworkError(error) {
        return !error.response && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND');
    }

    static async handleWithRetry(fn, maxRetries = 3, delay = 1000) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (!this.isNetworkError(error) && !this.isRateLimitError(error)) throw error;
                if (i < maxRetries - 1) await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
        throw lastError;
    }
}

class FacebookAPI extends EventEmitter {
    constructor(ctx, api) {
        super();
        this.ctx = ctx;
        this.api = api;
        this.cache = new APIResponseCache(200, 600000);
        this.requestQueue = new RequestQueue(10, 100);
        this.mqtt = null;
        self.listenMqtt = true;
        this.pendingPromises = new Map();
        this.listening = false;
        this.reconnectTimer = null;
    }

    setOptions(options) {
        Object.keys(options).forEach(key => {
            if (Boolean_Option.includes(key)) {
                this.ctx.globalOptions[key] = Boolean(options[key]);
            } else {
                this.ctx.globalOptions[key] = options[key];
            }
        });
    }

    async listen(callback) {
        if (this.listening) return;
        this.listening = true;

        if (this.ctx.globalOptions.listenEvents) {
            this.mqtt = new MQTTManager(this.ctx, this.api);

            this.mqtt.on('message', (data) => {
                try {
                    const events = this.parseMQTTMessage(data);
                    events.forEach(event => {
                        if (callback) callback(null, event);
                        this.emit('event', event);
                    });
                } catch (err) {
                    if (callback) callback(err);
                    this.emit('error', err);
                }
            });

            this.mqtt.on('error', (err) => {
                if (callback) callback(err);
                this.emit('error', err);
            });

            this.mqtt.on('max_reconnect', () => {
                this.listening = false;
                if (callback) callback(new Error('Max reconnection attempts reached'));
                this.emit('disconnected');
            });

            this.mqtt.connect();
        }

        if (this.ctx.globalOptions.listenTyping) {
            this.startTypingListener(callback);
        }
    }

    parseMQTTMessage(data) {
        const events = [];
        try {
            if (data[0] === 0x42) {
                const payload = data.slice(16);
                const jsonStr = payload.toString('utf8');
                const parsed = JSON.parse(jsonStr);

                if (parsed && parsed.payload) {
                    const decoded = JSON.parse(parsed.payload);
                    events.push({
                        type: 'message',
                        threadID: decoded.threadID,
                        messageID: decoded.messageID,
                        senderID: decoded.senderID,
                        body: decoded.body,
                        attachments: decoded.attachments || [],
                        timestamp: decoded.timestamp
                    });
                }
            }
        } catch (err) {
            this.emit('error', new Error('Failed to parse MQTT message: ' + err.message));
        }
        return events;
    }

    startTypingListener(callback) {
        setInterval(async () => {
            try {
                const typingData = await this.api.getTypingIndicators();
                typingData.forEach(indicator => {
                    const event = {
                        type: 'typing',
                        from: indicator.from,
                        to: indicator.to,
                        status: indicator.status
                    };
                    if (callback) callback(null, event);
                    this.emit('typing', event);
                });
            } catch (err) {
                if (callback) callback(err);
            }
        }, 5000);
    }

    stopListening() {
        this.listening = false;
        if (this.mqtt) {
            this.mqtt.disconnect();
            this.mqtt = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    async sendMessage(message, threadID, callback) {
        return this.requestQueue.add(async () => {
            try {
                return await ErrorHandler.handleWithRetry(async () => {
                    return new Promise((resolve, reject) => {
                        const messageID = uuidv4();
                        this.pendingPromises.set(messageID, { resolve, reject, timeout: setTimeout(() => reject(new Error('Message send timeout')), 30000) });

                        this.api.sendMessage(message, threadID, (err, info) => {
                            clearTimeout(this.pendingPromises.get(messageID)?.timeout);
                            this.pendingPromises.delete(messageID);
                            if (err) reject(err);
                            else resolve(info);
                        });
                    });
                });
            } catch (error) {
                if (callback) callback(error);
                throw error;
            }
        });
    }

    async getThreadInfo(threadID, force = false) {
        if (!force) {
            const cached = this.cache.get(`thread:${threadID}`);
            if (cached) return cached;
        }

        return this.requestQueue.add(async () => {
            try {
                const result = await ErrorHandler.handleWithRetry(() => {
                    return new Promise((resolve, reject) => {
                        this.api.getThreadInfo(threadID, (err, info) => {
                            if (err) reject(err);
                            else resolve(info);
                        });
                    });
                });

                this.cache.set(`thread:${threadID}`, result);
                return result;
            } catch (error) {
                throw error;
            }
        });
    }

    async getUserInfo(userID, force = false) {
        if (!force) {
            const cached = this.cache.get(`user:${userID}`);
            if (cached) return cached;
        }

        return this.requestQueue.add(async () => {
            try {
                const result = await ErrorHandler.handleWithRetry(() => {
                    return new Promise((resolve, reject) => {
                        this.api.getUserInfo(userID, (err, info) => {
                            if (err) reject(err);
                            else resolve(info);
                        });
                    });
                });

                this.cache.set(`user:${userID}`, result);
                return result;
            } catch (error) {
                throw error;
            }
        });
    }

    async markAsRead(threadID) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(() => {
                return new Promise((resolve, reject) => {
                    this.api.markAsRead(threadID, (err) => {
                        if (err) reject(err);
                        else resolve(true);
                    });
                });
            });
        });
    }

    async changeNickname(nickname, threadID, userID) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(() => {
                return new Promise((resolve, reject) => {
                    this.api.changeNickname(nickname, threadID, userID, (err) => {
                        if (err) reject(err);
                        else resolve(true);
                    });
                });
            });
        });
    }

    async createPoll(title, options, threadID) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(() => {
                return new Promise((resolve, reject) => {
                    this.api.createPoll(title, options, threadID, (err, info) => {
                        if (err) reject(err);
                        else resolve(info);
                    });
                });
            });
        });
    }

    async deleteMessage(messageID) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(() => {
                return new Promise((resolve, reject) => {
                    this.api.deleteMessage(messageID, (err) => {
                        if (err) reject(err);
                        else resolve(true);
                    });
                });
            });
        });
    }

    async unsendMessage(messageID) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(() => {
                return new Promise((resolve, reject) => {
                    this.api.unsendMessage(messageID, (err) => {
                        if (err) reject(err);
                        else resolve(true);
                    });
                });
            });
        });
    }

    async reactToMessage(messageID, reaction, callback) {
        return this.requestQueue.add(async () => {
            try {
                return await ErrorHandler.handleWithRetry(() => {
                    return new Promise((resolve, reject) => {
                        this.api.setMessageReaction(reaction, messageID, (err, info) => {
                            if (err) reject(err);
                            else resolve(info);
                        });
                    });
                });
            } catch (error) {
                if (callback) callback(error);
                throw error;
            }
        });
    }

    async getThreadList(limit, timestamp, tags) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(() => {
                return new Promise((resolve, reject) => {
                    this.api.getThreadList(limit, timestamp, tags, (err, list) => {
                        if (err) reject(err);
                        else resolve(list);
                    });
                });
            });
        });
    }

    async searchForThread(name) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(() => {
                return new Promise((resolve, reject) => {
                    this.api.searchForThread(name, (err, results) => {
                        if (err) reject(err);
                        else resolve(results);
                    });
                });
            });
        });
    }

    async getEmojiUrl(emoji, size) {
        return this.api.getEmojiUrl(emoji, size);
    }

    async httpGet(url, options = {}) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(async () => {
                return utils.get(url, this.ctx.jar, null, this.ctx.globalOptions, options);
            });
        });
    }

    async httpPost(url, form, options = {}) {
        return this.requestQueue.add(async () => {
            return ErrorHandler.handleWithRetry(async () => {
                return utils.post(url, this.ctx.jar, form, null, this.ctx.globalOptions, options);
            });
        });
    }

    async refreshFbDtsg() {
        try {
            const res = await utils.get('https://www.facebook.com/', this.ctx.jar, null, this.ctx.globalOptions, { noRef: true });
            const html = res.body;

            const fb_dtsg = html.match(/"DTSGInitialData",\[\],{"token":"([^"]+)"}/)?.[1] ||
                html.match(/"fb_dtsg":"([^"]+)"/)?.[1];

            if (fb_dtsg) {
                this.ctx.fb_dtsg = fb_dtsg;
                return fb_dtsg;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async handleCheckpoint() {
        this.emit('checkpoint_detected');
        return this.refreshFbDtsg();
    }

    destroy() {
        this.stopListening();
        this.requestQueue.destroy();
        this.cache.clear();
        this.pendingPromises.forEach((promise, id) => {
            clearTimeout(promise.timeout);
            promise.reject(new Error('API destroyed'));
        });
        this.pendingPromises.clear();
        this.removeAllListeners();
    }
}

async function createAPI(appState, options = {}) {
    const jar = utils.getJar();
    appState.forEach(c => {
        const cookieStr = `${c.key}=${c.value}; expires=${c.expires}; domain=${c.domain}; path=${c.path};`;
        jar.setCookie(cookieStr, "https://" + c.domain.replace(/^\./, ''));
    });

    const res = await utils.get('https://www.facebook.com/', jar, null, options, { noRef: true });
    const html = res.body;

    if (html.includes("/checkpoint/block/?next")) {
        throw new Error("Account is checkpointed");
    }

    const fb_dtsg = html.match(/"DTSGInitialData",\[\],{"token":"([^"]+)"}/)?.[1] ||
        html.match(/"fb_dtsg":"([^"]+)"/)?.[1];

    if (!fb_dtsg) {
        throw new Error("Failed to extract fb_dtsg");
    }

    const userID = jar.getCookies("https://www.facebook.com").find(c => c.key === "c_user")?.value;
    if (!userID) {
        throw new Error("Couldn't find user cookie");
    }

    const clientID = (Math.random() * 2147483648 | 0).toString(16);
    const mqttEndpoint = html.match(/"endpoint":"([^"]+)"/)?.[1]?.replace(/\\/g, '');
    const region = mqttEndpoint ? new URL(mqttEndpoint).searchParams.get('region')?.toUpperCase() : "PRN";
    const irisSeqID = html.match(/"irisSeqID":"([^"]+)"/)?.[1];

    const ctx = {
        userID,
        jar,
        clientID,
        globalOptions: options,
        loggedIn: true,
        access_token: 'NONE',
        clientMutationId: 0,
        lastSeqId: irisSeqID,
        syncToken: undefined,
        mqttEndpoint,
        region,
        fb_dtsg,
    };

    const defaultFuncs = utils.makeDefaults(html, userID, ctx);
    const api = {
        setOptions: (opts) => { Object.keys(opts).forEach(k => { options[k] = opts[k]; }); },
        getAppState: () => utils.getAppState(jar)
    };

    const srcDir = path.join(__dirname, '/src/');
    if (fs.existsSync(srcDir)) {
        fs.readdirSync(srcDir).filter(v => v.endsWith('.js')).forEach(v => {
            const apiName = v.replace('.js', '');
            try {
                api[apiName] = require(path.join(srcDir, v))(defaultFuncs, api, ctx);
            } catch (e) {}
        });
    }

    const enhancedAPI = new FacebookAPI(ctx, api);
    Object.assign(enhancedAPI, api);

    return enhancedAPI;
}

class Authenticator {
    constructor(options = {}) {
        this.sessionManager = new SessionManager(options);
        this.apiKey = '882a8490361da98702bf97a021ddc14d';
        this.accessToken = '350685531728|62f8ce9f74b12f84c123cc23437a4a32';
        this.secretKey = '62f8ce9f74b12f84c123cc23437a4a32';
    }

    encodesig(data) {
        const sortedData = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('');
        return crypto.createHash('md5').update(sortedData + this.secretKey).digest('hex');
    }

    async login(credentials) {
        if (credentials.appState || credentials.appstate) {
            return this.loginWithAppState(credentials.appState || credentials.appstate);
        } else if (credentials.email && credentials.password) {
            return this.loginWithPassword(credentials);
        } else {
            throw new Error('Please provide either email/password or an appState for login.');
        }
    }

    async loginWithAppState(appState) {
        try {
            const api = await createAPI(appState, {});
            return { success: true, api, method: 'AppState' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async loginWithPassword(credentials) {
        const device = this.sessionManager.deviceManager.getRandomDevice();

        if (credentials.twofactor) credentials.twofactor = credentials.twofactor.replace(/\s+/g, '');

        const form = {
            adid: uuidv4(),
            email: credentials.email,
            password: credentials.password,
            format: 'json',
            device_id: device.deviceId,
            cpl: 'true',
            family_device_id: device.familyDeviceId,
            locale: 'en_US',
            client_country_code: 'US',
            credentials_type: 'device_based_login_password',
            generate_session_cookies: '1',
            generate_analytics_claim: '1',
            generate_machine_id: '1',
            currently_logged_in_userid: '0',
            irisSeqID: 1,
            try_num: "1",
            enroll_misauth: "false",
            meta_inf_fbmeta: "NO_FILE",
            source: 'login',
            machine_id: crypto.randomBytes(12).toString('hex'),
            fb_api_req_friendly_name: 'authenticate',
            fb_api_caller_class: 'com.facebook.account.login.protocol.Fb4aAuthHandler',
            api_key: this.apiKey,
            access_token: this.accessToken,
        };

        form.sig = this.encodesig(form);

        const options = {
            url: 'https://b-graph.facebook.com/auth/login',
            method: 'post',
            data: qs.stringify(form),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-fb-friendly-name': form.fb_api_req_friendly_name,
                'x-fb-http-engine': 'Liger',
                'user-agent': device.userAgent,
            }
        };

        try {
            const response = await axios.request(options);

            if (response.data.session_cookies) {
                const appState = response.data.session_cookies.map(c => ({ ...c, key: c.name }));
                this.sessionManager.saveAppstate(appState, { access_token: response.data.access_token });
                const api = await createAPI(appState, {});
                return { success: true, api, method: 'Password' };
            }

            if (response.data.error?.error_data?.two_factor_required) {
                return this.handleTwoFactor(response.data.error.error_data, form, device);
            }

            return { success: false, message: 'Login failed: ' + (response.data.error?.message || 'Unknown error') };
        } catch (error) {
            const responseData = error.response?.data;

            if (responseData?.error?.error_data?.two_factor_required && credentials.twofactor) {
                return this.handleTwoFactor(responseData.error.error_data, form, device, credentials.twofactor);
            }

            return { success: false, message: error.response?.data?.error?.message || error.message };
        }
    }

    async handleTwoFactor(errorData, form, device, twoFactorKey = null) {
        if (!twoFactorKey && !errorData.two_factor_code_required) {
            return { success: false, message: '2FA required but no key provided', twoFactorRequired: true, uid: errorData.uid };
        }

        try {
            let twoFactorCode;
            if (twoFactorKey) {
                twoFactorCode = TOTP.generate(twoFactorKey.toUpperCase()).otp;
            } else {
                return { success: false, message: '2FA code required', twoFactorRequired: true, uid: errorData.uid };
            }

            const twoFactorForm = { ...form, twofactor_code: twoFactorCode, userid: errorData.uid };
            twoFactorForm.sig = this.encodesig(twoFactorForm);

            const options = {
                url: 'https://b-graph.facebook.com/auth/login',
                method: 'post',
                data: qs.stringify(twoFactorForm),
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'x-fb-friendly-name': twoFactorForm.fb_api_req_friendly_name,
                    'x-fb-http-engine': 'Liger',
                    'user-agent': device.userAgent,
                }
            };

            const response = await axios.request(options);

            if (response.data.session_cookies) {
                const appState = response.data.session_cookies.map(c => ({ ...c, key: c.name }));
                this.sessionManager.saveAppstate(appState, { access_token: response.data.access_token, twoFactor: true });
                const api = await createAPI(appState, {});
                return { success: true, api, method: '2FA' };
            }

            return { success: false, message: '2FA verification failed' };
        } catch (error) {
            return { success: false, message: '2FA verification failed: ' + (error.response?.data?.error?.message || error.message) };
        }
    }
}

async function login(loginData, options = {}, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    const usePromise = typeof callback !== 'function';
    let promise;

    if (usePromise) {
        promise = new Promise((resolve, reject) => {
            callback = (err, api) => err ? reject(err) : resolve(api);
        });
    }

    const globalOptions = {
        selfListen: false,
        listenEvents: true,
        updatePresence: false,
        forceLogin: false,
        autoMarkDelivery: true,
        autoMarkRead: false,
        online: true,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        ...options
    };

    try {
        const authenticator = new Authenticator(options);

        if (authenticator.sessionManager.hasValidAppstate() && options.autoLogin !== false) {
            try {
                const appState = authenticator.sessionManager.loadAppstate();
                const api = await createAPI(appState, globalOptions);
                callback(null, api);
                return usePromise ? promise : undefined;
            } catch (e) {}
        }

        const result = await authenticator.login(loginData);

        if (!result.success) {
            throw new Error(result.message || 'Authentication failed');
        }

        callback(null, result.api);
    } catch (error) {
        callback(error);
    }

    return usePromise ? promise : undefined;
}

module.exports = login;