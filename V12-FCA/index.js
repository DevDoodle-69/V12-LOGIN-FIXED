"use strict";

const utils = require("./utils");
const cheerio = require("cheerio");
const log = require("npmlog");
log.level = 'error';

const fs = require("fs");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { TOTP } = require("totp-generator");

const Boolean_Option = [
    'online',
    'selfListen',
    'listenEvents',
    'updatePresence',
    'forceLogin',
    'autoMarkDelivery',
    'autoMarkRead',
    'listenTyping',
    'autoReconnect',
    'emitReady'
];

const CookieManager = {
    getDefaultExpiry() {
        const d = new Date();
        d.setTime(d.getTime() + 90 * 24 * 60 * 60 * 1000);
        return d.toUTCString();
    },

    fixCookieExpiry(appState) {
        if (!appState || !Array.isArray(appState)) return appState;
        return appState.map(c => {
            if (!c.expires || isNaN(new Date(c.expires).getTime())) {
                c.expires = this.getDefaultExpiry();
            }
            return c;
        });
    }
};

class LoginSystem {
    constructor(options = {}) {
        const dataDir = process.env.RENDER_DATA_DIR || process.cwd();
        this.options = {
            appstatePath: options.appstatePath || path.join(dataDir, "appstate.json"),
            credentialsPath: options.credentialsPath || path.join(dataDir, "credentials.json"),
            backupPath: options.backupPath || path.join(dataDir, "backups"),
            autoLogin: options.autoLogin !== false,
            persistentDevice: options.persistentDevice !== false,
            persistentDeviceFile: options.persistentDeviceFile || path.join(dataDir, "persistent-device.json"),
            ...options
        };
        this.fixedDeviceProfile = this.loadPersistentDevice();
        this.ensureDirectories();
    }

    ensureDirectories() {
        const dirs = [this.options.backupPath, path.dirname(this.options.appstatePath)];
        dirs.forEach(dir => {
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    loadPersistentDevice() {
        if (!this.options.persistentDevice) return null;
        try {
            if (fs.existsSync(this.options.persistentDeviceFile)) {
                const raw = JSON.parse(fs.readFileSync(this.options.persistentDeviceFile, "utf8"));
                if (raw?.deviceId && raw?.userAgent) {
                    return raw;
                }
            }
        } catch {}
        return null;
    }

    savePersistentDevice(profile) {
        if (!this.options.persistentDevice) return;
        try {
            fs.writeFileSync(this.options.persistentDeviceFile, JSON.stringify(profile, null, 2));
        } catch {}
    }

    getRandomDevice() {
        if (this.fixedDeviceProfile) return this.fixedDeviceProfile;

        const devices = [
            { model: "Pixel 7 Pro", build: "TQ3A.230901.001", release: "13" },
            { model: "SM-S908U", build: "TP1A.220624.014", release: "12" }
        ];
        const device = devices[Math.floor(Math.random() * devices.length)];

        const profile = {
            userAgent: `Dalvik/2.1.0 (Linux; U; Android ${device.release}; \( {device.model} Build/ \){device.build})`,
            deviceId: uuidv4(),
            familyDeviceId: uuidv4()
        };

        if (this.options.persistentDevice && !this.fixedDeviceProfile) {
            this.fixedDeviceProfile = profile;
            this.savePersistentDevice(profile);
        }

        return profile;
    }

    encodesig(data) {
        const signature = "62f8ce9f74b12f84c123cc23437a4a32";
        const sorted = Object.keys(data).sort().map(k => `\( {k}= \){data[k]}`).join("");
        return crypto.createHash("md5").update(sorted + signature).digest("hex");
    }

    hasValidAppstate() {
        try {
            if (!fs.existsSync(this.options.appstatePath)) return false;
            const state = JSON.parse(fs.readFileSync(this.options.appstatePath, "utf8"));
            return Array.isArray(state) && state.some(c => c.key === "c_user");
        } catch {
            return false;
        }
    }

    loadAppstate() {
        try {
            const state = JSON.parse(fs.readFileSync(this.options.appstatePath, "utf8"));
            return CookieManager.fixCookieExpiry(state);
        } catch {
            return null;
        }
    }

    saveAppstate(appstate, metadata = {}) {
        try {
            const fixed = CookieManager.fixCookieExpiry(appstate);
            fs.writeFileSync(this.options.appstatePath, JSON.stringify(fixed, null, 2));

            const name = `appstate_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
            const backupPath = path.join(this.options.backupPath, name);
            fs.writeFileSync(backupPath, JSON.stringify({ appstate: fixed, metadata }, null, 2));
        } catch {}
    }

    async generateAppstate(credentials) {
        const device = this.getRandomDevice();
        const clean2fa = credentials.twofactor?.replace(/\s+/g, "");

        const form = {
            adid: uuidv4(),
            email: credentials.username,
            password: credentials.password,
            format: "json",
            device_id: device.deviceId,
            cpl: "true",
            family_device_id: device.familyDeviceId,
            locale: "en_US",
            client_country_code: "US",
            credentials_type: "device_based_login_password",
            generate_session_cookies: "1",
            generate_analytics_claim: "1",
            generate_machine_id: "1",
            currently_logged_in_userid: "0",
            irisSeqID: 1,
            try_num: "1",
            enroll_misauth: "false",
            meta_inf_fbmeta: "NO_FILE",
            source: "login",
            machine_id: crypto.randomBytes(12).toString("hex"),
            fb_api_req_friendly_name: "authenticate",
            fb_api_caller_class: "com.facebook.account.login.protocol.Fb4aAuthHandler",
            api_key: "882a8490361da98702bf97a021ddc14d",
            access_token: "350685531728|62f8ce9f74b12f84c123cc23437a4a32"
        };
        form.sig = this.encodesig(form);

        const req = {
            url: "https://b-graph.facebook.com/auth/login",
            method: "post",
            data: new URLSearchParams(Object.entries(form)).toString(),
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "x-fb-friendly-name": form.fb_api_req_friendly_name,
                "x-fb-http-engine": "Liger",
                "user-agent": device.userAgent
            }
        };

        try {
            const resp = await axios.request(req);
            if (resp.data.session_cookies) {
                const appstate = resp.data.session_cookies.map(c => ({ ...c, key: c.name }));
                this.saveAppstate(appstate, { access_token: resp.data.access_token });
                return { success: true, appstate, method: "New Session" };
            }
        } catch (e) {
            const errData = e.response?.data?.error?.error_data;
            if (!errData || !clean2fa) {
                return { success: false, message: "Login failed. Invalid credentials." };
            }

            try {
                const code = TOTP.generate(clean2fa.toUpperCase()).otp;
                const tfForm = { ...form, twofactor_code: code, userid: errData.uid };
                tfForm.sig = this.encodesig(tfForm);
                req.data = new URLSearchParams(Object.entries(tfForm)).toString();

                const tfResp = await axios.request(req);
                if (tfResp.data.session_cookies) {
                    const appstate = tfResp.data.session_cookies.map(c => ({ ...c, key: c.name }));
                    this.saveAppstate(appstate, { access_token: tfResp.data.access_token });
                    return { success: true, appstate, method: "2FA" };
                }
            } catch {
                return { success: false, message: "2FA verification failed." };
            }
        }

        return { success: false, message: "Unknown login error." };
    }

    async login(credentials = null) {
        if (this.options.autoLogin && this.hasValidAppstate()) {
            const state = this.loadAppstate();
            if (state) return { success: true, appstate: state, method: "Cached Session" };
        }

        if (!credentials) {
            try {
                if (fs.existsSync(this.options.credentialsPath)) {
                    credentials = JSON.parse(fs.readFileSync(this.options.credentialsPath, "utf8"));
                }
            } catch {}
        }

        if (!credentials?.username || !credentials?.password) {
            return { success: false, message: "No valid credentials or session" };
        }

        return this.generateAppstate(credentials);
    }
}

async function enhancedLogin(credentials = null, options = {}) {
    const system = new LoginSystem(options);
    return system.login(credentials);
}

function setOptions(globalOptions, options) {
    Object.keys(options).forEach(key => {
        if (Boolean_Option.includes(key)) {
            globalOptions[key] = !!options[key];
        } else {
            globalOptions[key] = options[key];
        }
    });
}

function buildAPI(globalOptions, html, jar) {
    let fb_dtsg = null;
    let irisSeqID = null;

    try {
        fb_dtsg = html.match(/"DTSGInitialData",\[\],{"token":"([^"]+)"}/)?.[1]
               || html.match(/"fb_dtsg":"([^"]+)"/)?.[1];
        irisSeqID = html.match(/"irisSeqID":"([^"]+)"/)?.[1];
    } catch {}

    if (!fb_dtsg) return null;

    const userID = jar.getCookies("https://www.facebook.com")
                      .find(c => c.key === "c_user")?.value;

    if (!userID) return null;

    const clientID = (Math.random() * 2147483648 | 0).toString(16);
    const mqttEndpoint = html.match(/"endpoint":"([^"]+)"/)?.[1]?.replace(/\\/g, "");
    const region = mqttEndpoint ? new URL(mqttEndpoint).searchParams.get("region")?.toUpperCase() : "PRN";

    const ctx = {
        userID,
        jar,
        clientID,
        globalOptions,
        loggedIn: true,
        access_token: "NONE",
        clientMutationId: 0,
        lastSeqId: irisSeqID,
        syncToken: undefined,
        mqttEndpoint,
        region,
        fb_dtsg
    };

    const api = {
        setOptions: setOptions.bind(null, globalOptions),
        getAppState: () => utils.getAppState(jar)
    };

    const defaultFuncs = utils.makeDefaults(html, userID, ctx);

    fs.readdirSync(path.join(__dirname, "src"))
      .filter(v => v.endsWith(".js"))
      .forEach(v => {
          const name = v.replace(".js", "");
          api[name] = require(path.join(__dirname, "src", v))(defaultFuncs, api, ctx);
      });

    return { api, ctx };
}

async function loginHelper(appState, globalOptions, callback) {
    const jar = utils.getJar();

    appState.forEach(c => {
        const cookie = `\( {c.key}= \){c.value}; expires=\( {c.expires}; domain= \){c.domain}; path=${c.path};`;
        jar.setCookie(cookie, "https://" + c.domain.replace(/^\./, ""));
    });

    try {
        const res = await utils.get("https://www.facebook.com/", jar, null, globalOptions, { noRef: true });
        const html = res.body;

        if (html.includes("/checkpoint/block/?next")) {
            throw new Error("Account is checkpointed");
        }

        const built = buildAPI(globalOptions, html, jar);
        if (!built?.api) {
            throw new Error("Failed to initialize API");
        }

        callback(null, built.api);
    } catch (e) {
        callback(e);
    }
}

async function login(loginData, options, callback) {
    if (typeof options === "function") {
        callback = options;
        options = {};
    }

    const usePromise = typeof callback !== "function";
    let promise;
    if (usePromise) {
        promise = new Promise((res, rej) => {
            callback = (err, api) => err ? rej(err) : res(api);
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
        if (loginData.appState || loginData.appstate) {
            await loginHelper(loginData.appState || loginData.appstate, globalOptions, callback);
        } else if (loginData.email && loginData.password) {
            const result = await enhancedLogin({
                username: loginData.email,
                password: loginData.password,
                twofactor: loginData.twoFactorKey || loginData.twofactor || loginData.otp
            });

            if (!result.success || !result.appstate) {
                throw new Error(result.message || "Authentication failed");
            }

            await loginHelper(result.appstate, globalOptions, callback);
        } else {
            throw new Error("Provide either appState or email+password");
        }
    } catch (err) {
        callback(err);
    }

    return usePromise ? promise : undefined;
}

module.exports = login;