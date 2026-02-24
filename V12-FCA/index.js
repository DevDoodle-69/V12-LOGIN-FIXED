"use strict";

const utils = require("./utils");
const cheerio = require("cheerio");
const log = require("npmlog");
log.level = 'error';
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { TOTP } = require("totp-generator");
const gradient = require('gradient-string');

// --- Start of AMINULZISAN Custom Logger & Styling ---
const BRAND_NAME = "FCA";
const ZISAN_GRADIENT = gradient([
    { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 255, g: 255, b: 0 }
]);
const ZISAN_GRADIENT_REVERSE = gradient([
    { r: 255, g: 255, b: 0 }, { r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 255 }
]);
const chalk = require('chalk');

const logger = {
    info: (message) => console.log(chalk.bold.cyan(`[${BRAND_NAME}]`) + ` ${message}`),
    warn: (message) => console.log(chalk.bold.yellow(`[WARNING]`) + ` ${message}`),
    error: (message, details = '') => console.log(chalk.bold.red(`[ERROR]`) + ` ${message}`, details),
    success: (message) => console.log(chalk.bold.green(`[SUCCESS]`) + ` ${message}`),
    step: (message) => console.log(chalk.bold.magenta(`>`) + ` ${message}`)
};

let _fancyBannerPrinted = false;

function printFancyStartupBanner() {
    if (_fancyBannerPrinted) return;
    _fancyBannerPrinted = true;
    const bannerText = `
╔════════════════════════════════════════╗
║      AMINULZISAN-FCA V2.0              ║
║   Secure & Optimized Login System      ║
╚════════════════════════════════════════╝
    `;
    console.log(ZISAN_GRADIENT.multiline(bannerText));
}
// --- End of AMINULZISAN Custom Logger & Styling ---

var checkVerified = null;
const Boolean_Option = ['online', 'selfListen', 'listenEvents', 'updatePresence', 'forceLogin', 'autoMarkDelivery', 'autoMarkRead', 'listenTyping', 'autoReconnect', 'emitReady'];
global.ditconmemay = false;

const CookieManager = {
    getDefaultExpiry: function() {
        const d = new Date();
        d.setTime(d.getTime() + (90 * 24 * 60 * 60 * 1000));
        return d.toUTCString();
    },
    fixCookieExpiry: function(appState) {
        if (!appState || !Array.isArray(appState)) return appState;
        return appState.map(c => {
            if (!c.expires || isNaN(new Date(c.expires).getTime())) {
                c.expires = this.getDefaultExpiry();
            }
            return c;
        });
    }
};

class AminulzisanLoginSystem {
    constructor(options = {}) {
        const dataDir = process.env.RENDER_DATA_DIR || process.cwd();
        this.options = {
            appstatePath: options.appstatePath || path.join(dataDir, 'appstate.json'),
            credentialsPath: options.credentialsPath || path.join(dataDir, 'credentials.json'),
            backupPath: options.backupPath || path.join(dataDir, 'backups'),
            autoLogin: options.autoLogin !== false,
            persistentDevice: options.persistentDevice !== false,
            persistentDeviceFile: options.persistentDeviceFile || path.join(dataDir, 'persistent-device.json'),
            ...options
        };
        this.fixedDeviceProfile = this.loadPersistentDevice();
        this.ensureDirectories();
    }

    ensureDirectories() {
        try {
            const dirs = [this.options.backupPath, path.dirname(this.options.appstatePath)];
            dirs.forEach(dir => {
                if (dir && !fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            });
        } catch (e) {
            logger.warn('Failed to ensure directories: ' + e.message);
        }
    }

    loadPersistentDevice() {
        try {
            if (!this.options.persistentDevice) return null;
            if (fs.existsSync(this.options.persistentDeviceFile)) {
                const raw = JSON.parse(fs.readFileSync(this.options.persistentDeviceFile, 'utf8'));
                if (raw && raw.deviceId && raw.userAgent) {
                    logger.info('📱 Loaded persistent device profile.');
                    return raw;
                }
            }
        } catch (e) {
            logger.warn('Failed to load persistent device: ' + e.message);
        }
        return null;
    }

    savePersistentDevice(profile) {
        if (!this.options.persistentDevice) return;
        try {
            fs.writeFileSync(this.options.persistentDeviceFile, JSON.stringify(profile, null, 2));
        } catch (e) {
            logger.warn('Failed to save persistent device: ' + e.message);
        }
    }

    getRandomDevice() {
        if (this.fixedDeviceProfile) return this.fixedDeviceProfile;
        const devices = [{ model: "Pixel 7 Pro", build: "TQ3A.230901.001", release: "13" }, { model: "SM-S908U", build: "TP1A.220624.014", release: "12" }];
        const device = devices[Math.floor(Math.random() * devices.length)];
        const profile = {
            userAgent: `Dalvik/2.1.0 (Linux; U; Android ${device.release}; ${device.model} Build/${device.build})`,
            deviceId: uuidv4(),
            familyDeviceId: uuidv4(),
        };
        if (this.options.persistentDevice && !this.fixedDeviceProfile) {
            this.fixedDeviceProfile = profile;
            this.savePersistentDevice(profile);
        }
        return profile;
    }

    encodesig(data) {
        const signature = '62f8ce9f74b12f84c123cc23437a4a32';
        const sortedData = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('');
        return crypto.createHash('md5').update(sortedData + signature).digest('hex');
    }

    hasValidAppstate() {
        try {
            if (!fs.existsSync(this.options.appstatePath)) return false;
            const appstate = JSON.parse(fs.readFileSync(this.options.appstatePath, 'utf8'));
            return Array.isArray(appstate) && appstate.some(c => c.key === 'c_user');
        } catch (error) {
            return false;
        }
    }

    loadAppstate() {
        try {
            const appstate = JSON.parse(fs.readFileSync(this.options.appstatePath, 'utf8'));
            return CookieManager.fixCookieExpiry(appstate);
        } catch (error) {
            logger.error('Failed to load appstate.', error.message);
            return null;
        }
    }

    saveAppstate(appstate, metadata = {}) {
        try {
            const fixedAppstate = CookieManager.fixCookieExpiry(appstate);
            fs.writeFileSync(this.options.appstatePath, JSON.stringify(fixedAppstate, null, 2));

            const backupName = `appstate_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            const backupPath = path.join(this.options.backupPath, backupName);
            fs.writeFileSync(backupPath, JSON.stringify({ appstate: fixedAppstate, metadata }, null, 2));
        } catch (error) {
            logger.error('Failed to save appstate.', error.message);
        }
    }

    async generateAppstate(credentials) {
        const androidDevice = this.getRandomDevice();
        if (credentials.twofactor) credentials.twofactor = credentials.twofactor.replace(/\s+/g, '');

        const form = {
            adid: uuidv4(),
            email: credentials.username,
            password: credentials.password,
            format: 'json',
            device_id: androidDevice.deviceId,
            cpl: 'true',
            family_device_id: androidDevice.familyDeviceId,
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
            api_key: '882a8490361da98702bf97a021ddc14d',
            access_token: '350685531728|62f8ce9f74b12f84c123cc23437a4a32',
        };
        form.sig = this.encodesig(form);

        const options = {
            url: 'https://b-graph.facebook.com/auth/login',
            method: 'post',
            data: new URLSearchParams(Object.entries(form)).toString(),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-fb-friendly-name': form.fb_api_req_friendly_name,
                'x-fb-http-engine': 'Liger',
                'user-agent': androidDevice.userAgent,
            }
        };

        logger.step('Connecting to Facebook servers...');
        try {
            const response = await axios.request(options);
            if (response.data.session_cookies) {
                const appstate = response.data.session_cookies.map(c => ({ ...c, key: c.name }));
                this.saveAppstate(appstate, { access_token: response.data.access_token });
                return { success: true, appstate, method: 'New Session' };
            }
        } catch (error) {
            const errorData = error.response?.data?.error?.error_data;
            if (!errorData || !credentials.twofactor) {
                return { success: false, message: 'Login failed. Check credentials.' };
            }

            logger.step('2FA detected, attempting to verify...');
            try {
                const twoFactorCode = TOTP.generate(credentials.twofactor.toUpperCase()).otp;
                const twoFactorForm = { ...form, twofactor_code: twoFactorCode, userid: errorData.uid };
                twoFactorForm.sig = this.encodesig(twoFactorForm);
                options.data = new URLSearchParams(Object.entries(twoFactorForm)).toString();
                
                const twoFactorResponse = await axios.request(options);
                if (twoFactorResponse.data.session_cookies) {
                    const appstate = twoFactorResponse.data.session_cookies.map(c => ({ ...c, key: c.name }));
                    this.saveAppstate(appstate, { access_token: twoFactorResponse.data.access_token });
                    return { success: true, appstate, method: '2FA' };
                }
            } catch (requestError) {
                return { success: false, message: '2FA verification failed.' };
            }
        }
        return { success: false, message: 'An unknown login error occurred.' };
    }

    async login(credentials = null) {
        if (this.options.autoLogin && this.hasValidAppstate()) {
            logger.step('Existing session found. Logging in instantly.');
            const appstate = this.loadAppstate();
            if (appstate) return { success: true, appstate, method: 'Cached Session' };
        }
        if (!credentials) {
            if (fs.existsSync(this.options.credentialsPath)) {
                try {
                    credentials = JSON.parse(fs.readFileSync(this.options.credentialsPath, 'utf8'));
                } catch (error) { /* ignored */ }
            }
        }
        if (!credentials || !credentials.username || !credentials.password) {
            return { success: false, message: 'No valid session found and no credentials provided' };
        }
        logger.step('No cached session. Generating a new one...');
        return this.generateAppstate(credentials);
    }
}

async function enhancedLogin(credentials = null, options = {}) {
    printFancyStartupBanner();
    const loginSystem = new AminulzisanLoginSystem(options);
    logger.info('Initializing secure authentication...');
    const result = await loginSystem.login(credentials);
    if (!result.success) {
        logger.error(`Authentication failed: ${result.message}`);
        return result;
    }
    logger.success(`Authentication complete. Method: ${result.method}`);
    return result;
}

// --- End of AMINULZISAN Login System ---

function setOptions(globalOptions, options) {
    Object.keys(options).forEach(key => {
        if (Boolean_Option.includes(key)) {
            globalOptions[key] = Boolean(options[key]);
        } else {
            globalOptions[key] = options[key];
        }
    });
}

function buildAPI(globalOptions, html, jar) {
    const { fb_dtsg, irisSeqID } = (() => {
        try {
            const dtsg = html.match(/"DTSGInitialData",\[\],{"token":"([^"]+)"}/)?.[1] ||
                html.match(/"fb_dtsg":"([^"]+)"/)?.[1];
            const seqID = html.match(/"irisSeqID":"([^"]+)"/)?.[1];
            return { fb_dtsg: dtsg, irisSeqID: seqID };
        } catch (e) {
            return { fb_dtsg: null, irisSeqID: null };
        }
    })();

    if (!fb_dtsg) {
        logger.error("Failed to extract fb_dtsg. Your account may be checkpointed.");
        return null;
    }

    const userID = jar.getCookies("https://www.facebook.com").find(c => c.key === "c_user")?.value;
    if (!userID) {
        logger.error("Couldn't find user cookie. Login may have failed.");
        return null;
    }

    logger.success(`Logged in as ${chalk.bold(userID)}`);
    
    const clientID = (Math.random() * 2147483648 | 0).toString(16);
    const mqttEndpoint = html.match(/"endpoint":"([^"]+)"/)?.[1].replace(/\\/g, '');
    const region = mqttEndpoint ? new URL(mqttEndpoint).searchParams.get('region')?.toUpperCase() : "PRN";

    const ctx = {
        userID,
        jar,
        clientID,
        globalOptions,
        loggedIn: true,
        access_token: 'NONE',
        clientMutationId: 0,
        lastSeqId: irisSeqID,
        syncToken: undefined,
        mqttEndpoint,
        region,
        fb_dtsg,
    };

    const api = {
        setOptions: setOptions.bind(null, globalOptions),
        getAppState: () => utils.getAppState(jar),
    };

    const defaultFuncs = utils.makeDefaults(html, userID, ctx);
    fs.readdirSync(path.join(__dirname, '/src/')).filter(v => v.endsWith('.js')).forEach(v => {
        const apiName = v.replace('.js', '');
        api[apiName] = require(path.join(__dirname, `/src/${v}`))(defaultFuncs, api, ctx);
    });

    return { api, ctx };
}

async function loginHelper(appState, globalOptions, callback) {
    const jar = utils.getJar();
    try {
        appState.forEach(c => {
            const cookieStr = `${c.key}=${c.value}; expires=${c.expires}; domain=${c.domain}; path=${c.path};`;
            jar.setCookie(cookieStr, "https://" + c.domain.replace(/^\./, ''));
        });
        
        const res = await utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true });
        const html = res.body;

        if (html.includes("/checkpoint/block/?next")) {
            throw new Error("Account is checkpointed. Please resolve it on facebook.com.");
        }

        const { api } = buildAPI(globalOptions, html, jar);
        if (!api) {
            throw new Error("Failed to build API. The login session may be invalid.");
        }
        
        callback(null, api);
    } catch (e) {
        logger.error("Login helper failed.", e.message);
        callback(e);
    }
}

async function login(loginData, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    const usePromise = typeof callback !== 'function';
    const promise = usePromise ? new Promise((resolve, reject) => {
        callback = (err, api) => err ? reject(err) : resolve(api);
    }) : null;

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
        if (loginData.appState || loginData.appstate) {
            logger.info('Initializing session via appstate...');
            await loginHelper(loginData.appState || loginData.appstate, globalOptions, callback);
        } else if (loginData.email && loginData.password) {
            const result = await enhancedLogin({
                username: loginData.email,
                password: loginData.password,
                twofactor: loginData.twoFactorKey || loginData.twofactor || loginData.otp,
            });
            if (!result.success || !result.appstate) {
                throw new Error(result.message || 'Authentication failed.');
            }
            await loginHelper(result.appstate, globalOptions, callback);
        } else {
            throw new Error('Please provide either email/password or an appState for login.');
        }
    } catch (error) {
        logger.error('Login process failed.', error.message);
        callback(error);
    }
    return usePromise ? promise : undefined;
}

module.exports = login;
