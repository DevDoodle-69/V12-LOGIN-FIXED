"use strict";

const utils = require("./utils");
const cheerio = require("cheerio");
const log = require("npmlog");
log.level = 'silent';
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { TOTP } = require("totp-generator");
const chalk = require('chalk');
const EventEmitter = require('events');

const META = {
    name: "V12-FCA",
    version: "12.0.0",
    engine: "Liger",
    api_key: "882a8490361da98702bf97a021ddc14d",
    access_token: "350685531728|62f8ce9f74b12f84c123cc23437a4a32",
    signature: "62f8ce9f74b12f84c123cc23437a4a32",
    endpoint: "https://b-api.facebook.com/method/auth.login",
    home: "https://www.facebook.com/"
};

const TERMINAL = {
    brand: (m) => console.log(chalk.bold.hex('#00CFFF')(`[${META.name}]`) + chalk.white(` ${m}`)),
    ok: (m) => console.log(chalk.bold.green(`[✓ OK]`) + chalk.white(` ${m}`)),
    warn: (m) => console.log(chalk.bold.yellow(`[⚠ WARN]`) + chalk.white(` ${m}`)),
    fail: (m, d = '') => console.log(chalk.bold.red(`[✗ ERR]`) + chalk.white(` ${m}`), d ? chalk.gray(d) : ''),
    step: (m) => console.log(chalk.bold.magenta(`  ›`) + chalk.white(` ${m}`)),
    dim: (m) => console.log(chalk.gray(`  ${m}`))
};

const DEVICE_POOL = [
    { model: "Pixel 8 Pro", build: "UD1A.230805.004", release: "14", brand: "Google" },
    { model: "Pixel 7", build: "UP1A.231005.007.A2", release: "14", brand: "Google" },
    { model: "SM-S928U", build: "UP1A.231005.007", release: "14", brand: "Samsung" },
    { model: "SM-A546E", build: "TP1A.220624.014", release: "13", brand: "Samsung" },
    { model: "OnePlus 12", build: "UKQ1.230924.001", release: "14", brand: "OnePlus" },
    { model: "OnePlus Nord 3", build: "TP1A.220905.001", release: "13", brand: "OnePlus" },
    { model: "Xiaomi 14", build: "UKQ1.230804.001", release: "14", brand: "Xiaomi" },
    { model: "Redmi Note 13 Pro", build: "TP1A.220624.014", release: "13", brand: "Xiaomi" },
    { model: "CPH2525", build: "TP1A.220624.014", release: "13", brand: "OPPO" },
    { model: "V2254", build: "UP1A.231005.007", release: "14", brand: "vivo" },
    { model: "motorola edge 40", build: "TP1A.220624.014", release: "13", brand: "Motorola" },
    { model: "RMX3760", build: "TP1A.220624.014", release: "13", brand: "realme" },
    { model: "SM-F946B", build: "UP1A.231005.007", release: "14", brand: "Samsung" },
    { model: "Pixel 6a", build: "TP1A.221005.002", release: "13", brand: "Google" },
    { model: "SM-G991B", build: "TP1A.220624.014", release: "13", brand: "Samsung" }
];

const FB_APP_VERSIONS = [
    "440.0.0.30.113",
    "441.0.0.29.107",
    "442.0.0.31.118",
    "443.0.0.28.119",
    "444.0.0.32.120"
];

const DEFAULT_OPTIONS = {
    selfListen: false,
    listenEvents: true,
    updatePresence: false,
    forceLogin: false,
    autoMarkDelivery: true,
    autoMarkRead: false,
    listenTyping: false,
    online: true,
    autoReconnect: true,
    emitReady: false,
    logLevel: 'silent',
    pageId: null,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    requestTimeout: 60000,
    loginTimeout: 20000,
    maxRetries: 3,
    retryDelay: 2000
};

class RateLimiter {
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }

    canMakeRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(t => now - t < this.windowMs);
        if (this.requests.length < this.maxRequests) {
            this.requests.push(now);
            return true;
        }
        return false;
    }

    async waitForSlot() {
        while (!this.canMakeRequest()) {
            await new Promise(r => setTimeout(r, 100));
        }
    }
}

class DeviceRegistry {
    constructor(persistentFile, usePersistent = true) {
        this.persistentFile = persistentFile;
        this.usePersistent = usePersistent;
        this._profile = null;
        this._load();
    }

    _load() {
        if (!this.usePersistent) return;
        try {
            if (fs.existsSync(this.persistentFile)) {
                this._profile = JSON.parse(fs.readFileSync(this.persistentFile, 'utf8'));
            }
        } catch (_) {}
    }

    _save(profile) {
        if (!this.usePersistent) return;
        try {
            fs.writeFileSync(this.persistentFile, JSON.stringify(profile, null, 2));
        } catch (_) {}
    }

    _buildUserAgent(device, appVersion) {
        return `Dalvik/2.1.0 (Linux; U; Android ${device.release}; ${device.model} Build/${device.build}) [FBAN/FB4A;FBAV/${appVersion};FBPN/com.facebook.katana;FBLC/en_US;FBBV/534341512;FBCR/;FBMF/${device.brand};FBBD/${device.brand};FBDV/${device.model};FBSV/${device.release};FBOP/1;FBCA/arm64-v8a:armeabi-v7a:armeabi;]`;
    }

    get() {
        if (this._profile) return this._profile;
        const device = DEVICE_POOL[Math.floor(Math.random() * DEVICE_POOL.length)];
        const appVersion = FB_APP_VERSIONS[Math.floor(Math.random() * FB_APP_VERSIONS.length)];
        const profile = {
            userAgent: this._buildUserAgent(device, appVersion),
            deviceId: uuidv4(),
            familyDeviceId: uuidv4(),
            machineId: crypto.randomBytes(16).toString('hex'),
            model: device.model,
            release: device.release,
            brand: device.brand,
            appVersion
        };
        this._profile = profile;
        this._save(profile);
        return profile;
    }

    rotate() {
        this._profile = null;
        return this.get();
    }
}

class SessionStore {
    constructor(opts) {
        this.appstatePath = opts.appstatePath;
        this.credentialsPath = opts.credentialsPath;
        this.backupDir = opts.backupPath;
        this._ensureDirs();
    }

    _ensureDirs() {
        const dirs = [this.backupDir, path.dirname(this.appstatePath)].filter(Boolean);
        dirs.forEach(d => {
            try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {}
        });
    }

    _fixExpiries(appstate) {
        if (!Array.isArray(appstate)) return appstate;
        const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
        return appstate.map(c => {
            if (!c.expires || isNaN(new Date(c.expires).getTime())) c.expires = future;
            return c;
        });
    }

    load() {
        try {
            if (fs.existsSync(this.appstatePath)) {
                const data = JSON.parse(fs.readFileSync(this.appstatePath, 'utf8'));
                if (Array.isArray(data) && data.length > 0) return data;
            }
        } catch (_) {}
        return null;
    }

    save(appstate) {
        try {
            const fixed = this._fixExpiries(appstate);
            fs.writeFileSync(this.appstatePath, JSON.stringify(fixed, null, 2));
            const bkFile = path.join(this.backupDir, `v12_session_${Date.now()}.json`);
            fs.writeFileSync(bkFile, JSON.stringify(fixed));
            this._pruneBackups();
            return true;
        } catch (_) { return false; }
    }

    _pruneBackups(keep = 5) {
        try {
            const files = fs.readdirSync(this.backupDir)
                .filter(f => f.startsWith('v12_session_') && f.endsWith('.json'))
                .map(f => ({ name: f, time: parseInt(f.replace('v12_session_', '').replace('.json', '')) }))
                .sort((a, b) => b.time - a.time);
            files.slice(keep).forEach(f => {
                try { fs.unlinkSync(path.join(this.backupDir, f.name)); } catch (_) {}
            });
        } catch (_) {}
    }

    loadCredentials() {
        try {
            if (fs.existsSync(this.credentialsPath)) {
                return JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
            }
        } catch (_) {}
        return null;
    }

    isValid(appstate) {
        if (!Array.isArray(appstate) || appstate.length === 0) return false;
        const required = ['c_user', 'xs'];
        const keys = appstate.map(c => c.key || c.name);
        return required.every(r => keys.includes(r));
    }
}

class AuthEngine {
    constructor(deviceRegistry, sessionStore, options = {}) {
        this.device = deviceRegistry;
        this.store = sessionStore;
        this.timeout = options.loginTimeout || 20000;
        this.proxy = options.proxy || null;
        this.rateLimiter = new RateLimiter(5, 10000);
    }

    _sign(data) {
        const sorted = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('');
        return crypto.createHash('md5').update(sorted + META.signature).digest('hex');
    }

    _buildLoginForm(credentials, device) {
        const form = {
            adid: uuidv4(),
            email: credentials.username,
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
            machine_id: device.machineId,
            api_key: META.api_key,
            access_token: META.access_token,
            sig: ''
        };
        form.sig = this._sign(form);
        return form;
    }

    _axiosConfig(form, device) {
        const config = {
            url: META.endpoint,
            method: 'post',
            data: new URLSearchParams(form).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': device.userAgent,
                'X-FB-HTTP-Engine': META.engine,
                'X-FB-Client-IP': 'True',
                'X-FB-Server-Cluster': 'True',
                'X-MSGR-Region': 'ATN'
            },
            timeout: this.timeout
        };
        if (this.proxy) config.proxy = this.proxy;
        return config;
    }

    async _postLogin(form, device) {
        await this.rateLimiter.waitForSlot();
        const cfg = this._axiosConfig(form, device);
        const res = await axios.request(cfg);
        return res.data;
    }

    async _attemptTwoFactor(form, device, errorData, secret) {
        const clean = secret.replace(/\s+/g, '').toUpperCase();
        const otp = TOTP.generate(clean).otp;
        const tfForm = {
            ...form,
            twofactor_code: otp,
            twofactor_type: 'totp',
            userid: errorData.uid,
            credentials_type: 'two_factor'
        };
        tfForm.sig = this._sign(tfForm);
        try {
            const data = await this._postLogin(tfForm, device);
            if (data.session_cookies) {
                return { success: true, cookies: data.session_cookies, method: '2FA-TOTP' };
            }
            return { success: false, message: data.error_msg || '2FA_REJECTED' };
        } catch (e) {
            return { success: false, message: '2FA_NETWORK_ERROR' };
        }
    }

    async authenticate(credentials) {
        const device = this.device.get();
        const normalizedCreds = {
            username: credentials.username || credentials.email,
            password: credentials.password,
            twofactor: credentials.twofactor || credentials.twoFactorKey || credentials.otp
        };

        if (normalizedCreds.twofactor) {
            normalizedCreds.twofactor = normalizedCreds.twofactor.replace(/\s+/g, '');
        }

        const form = this._buildLoginForm(normalizedCreds, device);

        try {
            const data = await this._postLogin(form, device);

            if (data.session_cookies) {
                const appstate = data.session_cookies.map(c => ({ ...c, key: c.name }));
                return { success: true, appstate, method: 'Direct', device };
            }

            if (data.error_data && normalizedCreds.twofactor) {
                return this._attemptTwoFactor(form, device, data.error_data, normalizedCreds.twofactor).then(res => {
                    if (!res.success) return res;
                    return { success: true, appstate: res.cookies.map(c => ({ ...c, key: c.name })), method: res.method, device };
                });
            }

            if (data.error_msg) return { success: false, message: data.error_msg, code: data.error };
            return { success: false, message: 'AUTH_UNKNOWN_RESPONSE' };

        } catch (e) {
            const errData = e.response?.data;
            if (errData?.error_data && normalizedCreds.twofactor) {
                const tfResult = await this._attemptTwoFactor(form, device, errData.error_data, normalizedCreds.twofactor);
                if (tfResult.success) {
                    return { success: true, appstate: tfResult.cookies.map(c => ({ ...c, key: c.name })), method: tfResult.method, device };
                }
                return tfResult;
            }
            return {
                success: false,
                message: errData?.error_msg || e.message || 'NETWORK_ERROR',
                code: errData?.error
            };
        }
    }
}

class ConnectionManager extends EventEmitter {
    constructor(opts = {}) {
        super();
        const dataDir = process.env.RENDER_DATA_DIR || process.cwd();

        this.config = {
            appstatePath: opts.appstatePath || path.join(dataDir, 'appstate.json'),
            credentialsPath: opts.credentialsPath || path.join(dataDir, 'credentials.json'),
            backupPath: opts.backupPath || path.join(dataDir, 'backups'),
            persistentDeviceFile: opts.persistentDeviceFile || path.join(dataDir, 'v12-device.json'),
            persistentDevice: opts.persistentDevice !== false,
            autoLogin: opts.autoLogin !== false,
            loginTimeout: opts.loginTimeout || 20000,
            proxy: opts.proxy || null,
            ...opts
        };

        this.deviceRegistry = new DeviceRegistry(this.config.persistentDeviceFile, this.config.persistentDevice);
        this.sessionStore = new SessionStore({
            appstatePath: this.config.appstatePath,
            credentialsPath: this.config.credentialsPath,
            backupPath: this.config.backupPath
        });
        this.authEngine = new AuthEngine(this.deviceRegistry, this.sessionStore, this.config);
    }

    async resolveAppstate(loginData) {
        if (loginData.appState || loginData.appstate) {
            return { success: true, appstate: loginData.appState || loginData.appstate, method: 'Provided' };
        }

        if (this.config.autoLogin) {
            const cached = this.sessionStore.load();
            if (cached && this.sessionStore.isValid(cached)) {
                return { success: true, appstate: cached, method: 'Cache' };
            }
        }
this
        const credentials = {
            username: loginData.email || loginData.username,
            password: loginData.password,
            twofactor: loginData.twoFactorKey || loginData.otp || loginData.twofactor
        } || this.sessionStore.loadCredentials();

        if (!credentials?.username) return { success: false, message: 'NO_CREDENTIALS' };

        const result = await this.authEngine.authenticate(credentials);
        if (result.success) {
            this.sessionStore.save(result.appstate);
            TERMINAL.ok(`Authenticated via ${result.method}`);
        }
        return result;
    }
}

function buildAPIContext(globalOptions, html, jar) {
    const extractToken = (patterns, src) => {
        for (const pat of patterns) {
            const m = src.match(pat);
            if (m?.[1]) return m[1];
        }
        return null;
    };

    const fb_dtsg = extractToken([
        /"DTSGInitialData",\[\],{"token":"([^"]+)"}/,
        /"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/,
        /"fb_dtsg"\s*:\s*"([^"]+)"/,
        /"fb_dtsg":"([^"]+)"/,
        /name="fb_dtsg"\s+value="([^"]+)"/,
        /name="fb_dtsg" value="([^"]+)"/,
        /"token":"([^"]+)","ttl":/,
        /\["DTSGInitialData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/
    ], html);

    const irisSeqID = extractToken([
        /"irisSeqID":"([^"]+)"/,
        /"seq_num":([0-9]+)/,
        /"IrisSeqID":([0-9]+)/
    ], html);

    const allCookies = jar.getCookies("https://www.facebook.com");
    const allCookiesFb = jar.getCookies("https://facebook.com");
    const findCookie = (name) =>
        allCookies.find(c => c.key === name)?.value ||
        allCookiesFb.find(c => c.key === name)?.value;

    let userID = findCookie("c_user");
    if (!userID) {
        userID = extractToken([
            /"USER_ID":"([^"]+)"/,
            /"userID":"([^"]+)"/,
            /"user_id":"([^"]+)"/,
            /"actorID":"([^"]+)"/,
            /"uid":([0-9]+)/,
            /"UID":"([^"]+)"/
        ], html);
    }

    const locale = findCookie("locale") || extractToken([/"locale":"([^"]+)"/], html) || "en_US";

    if (!fb_dtsg || !userID) {
        TERMINAL.warn(`Token extraction — fb_dtsg: ${fb_dtsg ? 'found' : 'missing'}, userID: ${userID ? 'found' : 'missing'}`);
        TERMINAL.warn(`Response preview: ${html.slice(0, 300).replace(/\n/g, ' ')}`);
        return null;
    }

    const mqttEndpoint = extractToken([/"endpoint":"([^"]+)"/], html)?.replace(/\\/g, '') || null;
    const revision = extractToken([/\["revision"\]:\s*([0-9]+)/, /"client_revision":([0-9]+)/], html);

    return {
        userID,
        jar,
        fb_dtsg,
        globalOptions,
        clientID: (Math.random() * 2147483648 | 0).toString(16),
        loggedIn: true,
        lastSeqId: irisSeqID,
        mqttEndpoint,
        revision,
        locale,
        sessionID: crypto.randomBytes(8).toString('hex'),
        connectedAt: Date.now()
    };
}

function buildAPI(globalOptions, html, jar) {
    const ctx = buildAPIContext(globalOptions, html, jar);
    if (!ctx) return null;

    const api = {
        setOptions: (opt) => {
            Object.keys(opt).forEach(k => { globalOptions[k] = opt[k]; });
        },
        getAppState: () => utils.getAppState(jar),
        getContext: () => ({ ...ctx, jar: undefined }),
        isLoggedIn: () => ctx.loggedIn,
        getUserID: () => ctx.userID,
        getSessionAge: () => Date.now() - ctx.connectedAt,
        logout: async () => {
            try {
                await utils.post("https://www.facebook.com/logout.php", jar, { ref: "mb", h: ctx.fb_dtsg }, globalOptions);
                ctx.loggedIn = false;
            } catch (_) {}
        }
    };

    const defaultFuncs = utils.makeDefaults(html, ctx.userID, ctx);
    const srcPath = path.join(__dirname, '/src/');

    if (fs.existsSync(srcPath)) {
        const modules = fs.readdirSync(srcPath).filter(v => v.endsWith('.js') && !v.endsWith('.txt'));
        modules.forEach(v => {
            const modName = v.replace('.js', '');
            try {
                api[modName] = require(path.join(srcPath, v))(defaultFuncs, api, ctx);
            } catch (e) {
                TERMINAL.warn(`Module load failed: ${modName}`);
            }
        });
        TERMINAL.dim(`Loaded ${modules.length} API modules`);
    }

    return { api, ctx };
}

async function login(loginData, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    options = options || {};
    const usePromise = typeof callback !== 'function';
    let resolve, reject;
    const promise = usePromise ? new Promise((res, rej) => { resolve = res; reject = rej; }) : null;
    if (usePromise) callback = (e, a) => e ? reject(e) : resolve(a);

    const globalOptions = { ...DEFAULT_OPTIONS, ...options };

    const manager = new ConnectionManager(options);

    TERMINAL.brand(`Initializing ${META.name} v${META.version}`);

    try {
        const auth = await manager.resolveAppstate(loginData);
        if (!auth.success) throw new Error(`[AUTH_FAILED] ${auth.message}`);

        const jar = utils.getJar();

        auth.appstate.forEach(c => {
            const key = c.key || c.name;
            const val = c.value;
            if (!key || val === undefined || val === null) return;
            const rawDomain = c.domain || 'facebook.com';
            const cleanDomain = rawDomain.replace(/^\./, '');
            const expiry = (c.expires && c.expires !== 'undefined')
                ? c.expires
                : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
            const cookieStr = `${key}=${val}; expires=${expiry}; domain=.${cleanDomain}; path=${c.path || '/'}`;
            try { jar.setCookie(cookieStr, `https://${cleanDomain}`); } catch (_) {}
            try { jar.setCookie(cookieStr, `https://www.${cleanDomain}`); } catch (_) {}
        });

        TERMINAL.step(`Session loaded [${auth.method}]`);

        const res = await utils.get(META.home, jar, null, globalOptions);

        if (!res?.body) throw new Error("EMPTY_RESPONSE");
        const body = res.body;
        if (body.includes("/checkpoint/block/")) throw new Error("CHECKPOINT_LOCKED — Account security check required");
        if (body.includes("login_form") && body.includes("email") && body.includes("pass") && !body.includes("c_user")) throw new Error("SESSION_EXPIRED — Session cookies are no longer valid");
        if (body.includes("/login/") && body.length < 15000) throw new Error("SESSION_EXPIRED — Redirected to login page");

        const built = buildAPI(globalOptions, body, jar);
        if (!built) throw new Error("API_BUILD_FAILED — Could not extract session tokens from Facebook response");

        TERMINAL.ok(`Connected as UID: ${chalk.bold.cyan(built.ctx.userID)}`);

        callback(null, built.api);

    } catch (e) {
        TERMINAL.fail(`Login failed: ${e.message}`);
        callback(e);
    }

    return promise;
}

login.getVersion = () => META.version;
login.getName = () => META.name;
login.DeviceRegistry = DeviceRegistry;
login.SessionStore = SessionStore;
login.AuthEngine = AuthEngine;
login.ConnectionManager = ConnectionManager;
login.RateLimiter = RateLimiter;

module.exports = login;
