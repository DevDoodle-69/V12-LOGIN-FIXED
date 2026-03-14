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
const chalk = require('chalk');

const BRAND_NAME = "V12-FCA";

const logger = {
    info: (m) => console.log(chalk.bold.cyan(`[${BRAND_NAME}]`) + ` ${m}`),
    warn: (m) => console.log(chalk.bold.yellow(`[WARN]`) + ` ${m}`),
    error: (m, d = '') => console.log(chalk.bold.red(`[ERR]`) + ` ${m}`, d),
    success: (m) => console.log(chalk.bold.green(`[OK]`) + ` ${m}`),
    step: (m) => console.log(chalk.bold.magenta(`•`) + ` ${m}`)
};

const Boolean_Option = ['online', 'selfListen', 'listenEvents', 'updatePresence', 'forceLogin', 'autoMarkDelivery', 'autoMarkRead', 'listenTyping', 'autoReconnect', 'emitReady'];

const CookieManager = {
    getDefaultExpiry: function() {
        const d = new Date();
        d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
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

class V12LoginCore {
    constructor(options = {}) {
        const dataDir = process.env.RENDER_DATA_DIR || process.cwd();
        this.options = {
            appstatePath: options.appstatePath || path.join(dataDir, 'appstate.json'),
            credentialsPath: options.credentialsPath || path.join(dataDir, 'credentials.json'),
            backupPath: options.backupPath || path.join(dataDir, 'backups'),
            autoLogin: options.autoLogin !== false,
            persistentDevice: options.persistentDevice !== false,
            persistentDeviceFile: options.persistentDeviceFile || path.join(dataDir, 'v12-device.json'),
            proxy: options.proxy || null,
            timeout: options.timeout || 15000,
            ...options
        };
        this.fixedDeviceProfile = this.loadPersistentDevice();
        this.ensureDirectories();
    }

    ensureDirectories() {
        try {
            [this.options.backupPath, path.dirname(this.options.appstatePath)].forEach(dir => {
                if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            });
        } catch (e) {}
    }

    loadPersistentDevice() {
        try {
            if (this.options.persistentDevice && fs.existsSync(this.options.persistentDeviceFile)) {
                return JSON.parse(fs.readFileSync(this.options.persistentDeviceFile, 'utf8'));
            }
        } catch (e) {}
        return null;
    }

    savePersistentDevice(profile) {
        if (!this.options.persistentDevice) return;
        try {
            fs.writeFileSync(this.options.persistentDeviceFile, JSON.stringify(profile, null, 2));
        } catch (e) {}
    }

    getRandomDevice() {
        if (this.fixedDeviceProfile) return this.fixedDeviceProfile;
        const devices = [
            { model: "Pixel 8 Pro", build: "UD1A.230805.004", release: "14" },
            { model: "S24 Ultra", build: "UP1A.231005.007", release: "14" },
            { model: "OnePlus 12", build: "UKQ1.230924.001", release: "14" }
        ];
        const device = devices[Math.floor(Math.random() * devices.length)];
        const profile = {
            userAgent: `Dalvik/2.1.0 (Linux; U; Android ${device.release}; ${device.model} Build/${device.build}) [FBAN/FB4A;FBAV/440.0.0.30.113;FBPN/com.facebook.katana;FBLC/en_US;FBBV/534341512;FBCR/Verizon;FBMF/Google;FBBD/Google;FBPN/com.facebook.katana;FBDV/${device.model};FBSV/${device.release};FBOP/1;FBCA/arm64-v8a:;]`,
            deviceId: uuidv4(),
            familyDeviceId: uuidv4(),
            machineId: crypto.randomBytes(12).toString('hex')
        };
        if (this.options.persistentDevice) {
            this.fixedDeviceProfile = profile;
            this.savePersistentDevice(profile);
        }
        return profile;
    }

    encodesig(data) {
        const signature = '62f8ce9f74b12f84c123cc23437a4a32';
        const sortedData = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('');
        return crypto.createHash('md5').update(sortedData + signature).digest('hex');
    }

    async generateAppstate(credentials) {
        const device = this.getRandomDevice();
        if (credentials.twofactor) credentials.twofactor = credentials.twofactor.replace(/\s+/g, '');

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
            api_key: '882a8490361da98702bf97a021ddc14d',
            access_token: '350685531728|62f8ce9f74b12f84c123cc23437a4a32',
            sig: ''
        };
        form.sig = this.encodesig(form);

        const config = {
            url: 'https://b-api.facebook.com/method/auth.login',
            method: 'post',
            data: new URLSearchParams(form).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': device.userAgent,
                'X-FB-HTTP-Engine': 'Liger'
            },
            timeout: this.options.timeout
        };

        try {
            const res = await axios.request(config);
            if (res.data.session_cookies) {
                const appstate = res.data.session_cookies.map(c => ({ ...c, key: c.name }));
                this.saveAppstate(appstate);
                return { success: true, appstate, method: 'Fresh' };
            }
        } catch (error) {
            const errorData = error.response?.data?.error_data;
            if (errorData && credentials.twofactor) {
                try {
                    const otp = TOTP.generate(credentials.twofactor.toUpperCase()).otp;
                    const twoFactorForm = { ...form, twofactor_code: otp, userid: errorData.uid };
                    twoFactorForm.sig = this.encodesig(twoFactorForm);
                    config.data = new URLSearchParams(twoFactorForm).toString();

                    const tfRes = await axios.request(config);
                    if (tfRes.data.session_cookies) {
                        const appstate = tfRes.data.session_cookies.map(c => ({ ...c, key: c.name }));
                        this.saveAppstate(appstate);
                        return { success: true, appstate, method: '2FA' };
                    }
                } catch (e) {
                    return { success: false, message: '2FA_FAILED' };
                }
            }
            return { success: false, message: error.response?.data?.error_msg || 'AUTH_ERROR' };
        }
        return { success: false, message: 'UNKNOWN_ERROR' };
    }

    saveAppstate(appstate) {
        try {
            const fixed = CookieManager.fixCookieExpiry(appstate);
            fs.writeFileSync(this.options.appstatePath, JSON.stringify(fixed, null, 2));
            const bk = path.join(this.options.backupPath, `v12_bk_${Date.now()}.json`);
            fs.writeFileSync(bk, JSON.stringify(fixed));
        } catch (e) {}
    }

    async login(credentials = null) {
        if (this.options.autoLogin && fs.existsSync(this.options.appstatePath)) {
            try {
                const appstate = JSON.parse(fs.readFileSync(this.options.appstatePath, 'utf8'));
                if (Array.isArray(appstate)) return { success: true, appstate, method: 'Cache' };
            } catch (e) {}
        }
        if (!credentials && fs.existsSync(this.options.credentialsPath)) {
            try {
                credentials = JSON.parse(fs.readFileSync(this.options.credentialsPath, 'utf8'));
            } catch (e) {}
        }
        if (!credentials) return { success: false, message: 'NO_CREDENTIALS' };
        return this.generateAppstate(credentials);
    }
}

function buildAPI(globalOptions, html, jar) {
    const fb_dtsg = html.match(/"DTSGInitialData",\[\],{"token":"([^"]+)"}/)?.[1] || html.match(/"fb_dtsg":"([^"]+)"/)?.[1];
    const irisSeqID = html.match(/"irisSeqID":"([^"]+)"/)?.[1];
    const userID = jar.getCookies("https://www.facebook.com").find(c => c.key === "c_user")?.value;

    if (!fb_dtsg || !userID) return null;

    const ctx = {
        userID, jar, fb_dtsg, globalOptions,
        clientID: (Math.random() * 2147483648 | 0).toString(16),
        loggedIn: true,
        lastSeqId: irisSeqID,
        mqttEndpoint: html.match(/"endpoint":"([^"]+)"/)?.[1]?.replace(/\\/g, '')
    };

    const api = {
        setOptions: (opt) => Object.keys(opt).forEach(k => globalOptions[k] = opt[k]),
        getAppState: () => utils.getAppState(jar),
        logout: async () => {
            try {
                await utils.post("https://www.facebook.com/logout.php", jar, { ref: "mb", h: fb_dtsg }, globalOptions);
                ctx.loggedIn = false;
            } catch (e) {}
        }
    };

    const defaultFuncs = utils.makeDefaults(html, userID, ctx);
    const srcPath = path.join(__dirname, '/src/');
    if (fs.existsSync(srcPath)) {
        fs.readdirSync(srcPath).filter(v => v.endsWith('.js')).forEach(v => {
            api[v.replace('.js', '')] = require(path.join(srcPath, v))(defaultFuncs, api, ctx);
        });
    }

    return { api, ctx };
}

async function login(loginData, options = {}, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const usePromise = typeof callback !== 'function';
    const promise = usePromise ? new Promise((res, rej) => callback = (e, a) => e ? rej(e) : res(a)) : null;

    const globalOptions = {
        selfListen: false, listenEvents: true, updatePresence: false,
        forceLogin: false, autoMarkDelivery: true, autoMarkRead: false,
        online: true, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...options
    };

    try {
        const core = new V12LoginCore(options);
        const auth = (loginData.appState || loginData.appstate) 
            ? { success: true, appstate: loginData.appState || loginData.appstate }
            : await core.login({
                username: loginData.email,
                password: loginData.password,
                twofactor: loginData.twoFactorKey || loginData.otp
            });

        if (!auth.success) throw new Error(auth.message);

        const jar = utils.getJar();
        auth.appstate.forEach(c => {
            const str = `${c.key}=${c.value}; expires=${c.expires}; domain=${c.domain}; path=${c.path};`;
            jar.setCookie(str, "https://" + c.domain.replace(/^\./, ''));
        });

        const res = await utils.get('https://www.facebook.com/', jar, null, globalOptions);
        if (res.body.includes("/checkpoint/block/")) throw new Error("CHECKPOINT_DETECTED");

        const built = buildAPI(globalOptions, res.body, jar);
        if (!built) throw new Error("API_BUILD_FAILED");

        logger.success(`V12 Connected: ${built.ctx.userID}`);
        callback(null, built.api);
    } catch (e) {
        callback(e);
    }
    return promise;
}

module.exports = login;
