/* eslint-disable linebreak-style */
"use strict";

const utils = require("../utils");
const log = require("npmlog");
const fs = require('fs').promises;
const path = require('path');

/**
 * Validates screenshot options
 * @param {Object} options Screenshot configuration options
 * @returns {boolean} True if options are valid
 */
function validateOptions(options = {}) {
    const validFormats = ['png', 'jpg', 'jpeg', 'webp', 'pdf'];
    const validViewports = ['desktop', 'tablet', 'mobile'];
    
    if (options.format && !validFormats.includes(options.format.toLowerCase())) {
        return false;
    }
    if (options.viewport && !validViewports.includes(options.viewport.toLowerCase())) {
        return false;
    }
    if (options.width && (typeof options.width !== 'number' || options.width < 320 || options.width > 1920)) {
        return false;
    }
    if (options.height && (typeof options.height !== 'number' || options.height < 240 || options.height > 1080)) {
        return false;
    }
    if (options.delay && (typeof options.delay !== 'number' || options.delay < 0 || options.delay > 30000)) {
        return false;
    }
    
    return true;
}

/**
 * Converts cookie jar to cookie string for Puppeteer
 * @param {Object} jar The cookie jar from ctx
 * @param {string} domain The domain to get cookies for
 * @returns {Promise<Array>} Array of cookie objects
 */
async function getCookiesFromJar(jar, domain) {
    return new Promise((resolve, reject) => {
        try {
            const cookies = jar.getCookies(`https://${domain}`, (err, cookies) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const puppeteerCookies = cookies.map(cookie => ({
                    name: cookie.key,
                    value: cookie.value,
                    domain: cookie.domain,
                    path: cookie.path,
                    expires: cookie.expires ? new Date(cookie.expires).getTime() / 1000 : undefined,
                    httpOnly: cookie.httpOnly,
                    secure: cookie.secure,
                    sameSite: cookie.sameSite || 'Lax'
                }));
                
                resolve(puppeteerCookies);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Fetches screenshot using Puppeteer with bot session cookies
 * @param {string} url The Facebook profile URL
 * @param {Object} options Screenshot options
 * @param {Object} ctx The bot context containing cookie jar
 * @returns {Promise<Buffer>} The screenshot image buffer
 * @throws {Error} If screenshot capture fails
 */
async function fetchScreenshotWithSession(url, options = {}, ctx) {
    let browser, page;
    try {
        // Try to require puppeteer - it might not be installed
        let puppeteer;
        try {
            puppeteer = require('puppeteer');
        } catch (e) {
            throw new Error("Puppeteer is not installed. Please run: npm install puppeteer");
        }
        
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        });
        
        page = await browser.newPage();
        
        // Set user agent (use a realistic one)
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Set viewport
        await page.setViewport({
            width: options.width || 1280,
            height: options.height || 720,
            deviceScaleFactor: options.scale || 1
        });
        
        // Get and set cookies from the bot's session
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        
        try {
            const cookies = await getCookiesFromJar(ctx.jar, domain);
            if (cookies && cookies.length > 0) {
                await page.setCookie(...cookies);
                log.info('getScreenshot', `Set ${cookies.length} cookies from bot session`);
            }
        } catch (cookieError) {
            log.warn('getScreenshot', `Failed to set cookies: ${cookieError.message}`);
        }
        
        // Navigate to the page
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Wait for Facebook content to load
        try {
            await page.waitForSelector('[data-pagelet]', { timeout: 10000 });
        } catch (e) {
            log.warn('getScreenshot', 'Facebook content selector not found, continuing anyway');
        }
        
        // Wait additional time if specified
        if (options.delay && options.delay > 0) {
            await page.waitForTimeout(options.delay);
        }
        
        // Take screenshot
        const screenshotOptions = {
            type: (options.format === 'jpg' || options.format === 'jpeg') ? 'jpeg' : 'png',
            fullPage: options.fullPage || false
        };
        
        if (screenshotOptions.type === 'jpeg') {
            screenshotOptions.quality = 90;
        }
        
        const buffer = await page.screenshot(screenshotOptions);
        return buffer;
        
    } catch (e) {
        log.error('getScreenshot', `Failed to capture screenshot: ${e.message}`);
        throw e;
    } finally {
        if (page) await page.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

/**
 * Saves screenshot buffer to file
 * @param {Buffer} buffer The image buffer
 * @param {string} filename The output filename
 * @param {string} format The image format
 * @returns {Promise<string>} The file path
 */
async function saveScreenshot(buffer, filename, format = 'png') {
    try {
        const outputDir = path.join(process.cwd(), 'screenshots');
        await fs.mkdir(outputDir, { recursive: true });
        
        const timestamp = Date.now();
        const sanitizedFilename = filename.replace(/[^a-z0-9]/gi, '_');
        const filePath = path.join(outputDir, `${sanitizedFilename}_${timestamp}.${format}`);
        
        await fs.writeFile(filePath, buffer);
        return filePath;
    } catch (e) {
        log.error('getScreenshot', `Failed to save screenshot: ${e.message}`);
        throw e;
    }
}

module.exports = function (defaultFuncs, api, ctx) {
    /**
     * Takes a screenshot of a Facebook profile page from a given URL using bot session cookies.
     * @param {string} link The Facebook URL to screenshot
     * @param {Object} options Screenshot configuration options
     * @param {string} options.format - Image format (png, jpg, jpeg, webp) - default: 'png'
     * @param {number} options.width - Viewport width (320-1920) - default: 1280
     * @param {number} options.height - Viewport height (240-1080) - default: 720
     * @param {number} options.delay - Wait time in ms (0-30000) - default: 2000
     * @param {number} options.scale - Device scale factor - default: 1
     * @param {boolean} options.fullPage - Capture full page - default: false
     * @param {string} options.viewport - Preset viewport (desktop, tablet, mobile) - default: 'desktop'
     * @param {boolean} options.saveToFile - Save to file instead of returning buffer - default: false
     * @param {string} options.filename - Custom filename for saved file
     * @param {(err: Error | null, result?: Buffer | string) => void} [callback] Optional callback function
     * @returns {Promise<Buffer | string>} A promise that resolves with the screenshot buffer or file path
     */
    return function getScreenshot(link, options = {}, callback) {
        let resolveFunc = function() {};
        let rejectFunc = function() {};
        const returnPromise = new Promise(function(resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        // Handle overloaded function signature (link, callback)
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
            callback = function(err, data) {
                if (err) {
                    return rejectFunc(err);
                }
                resolveFunc(data);
            };
        }

        // Main async logic
        (async () => {
            if (typeof link !== 'string' || !link) {
                throw new Error("Invalid link provided. Expected a non-empty string.");
            }

            if (!validateOptions(options)) {
                throw new Error("Invalid options provided. Check format, viewport, dimensions, and delay values.");
            }

            let url;
            try {
                // Prepend protocol if missing to ensure proper parsing
                const fullLink = link.startsWith('http') ? link : `https://${link}`;
                url = new URL(fullLink);
            } catch (e) {
                throw new Error(`Invalid URL format: ${link}`);
            }

            // Check against a list of valid Facebook domains
            const validDomains = ['facebook.com', 'fb.com', 'm.facebook.com', 'web.facebook.com', 'mbasic.facebook.com'];
            if (!validDomains.some(domain => url.hostname.endsWith(domain))) {
                throw new Error("The provided link is not a valid Facebook URL.");
            }

            // Apply viewport presets
            if (options.viewport) {
                const viewportPresets = {
                    desktop: { width: 1280, height: 720 },
                    tablet: { width: 768, height: 1024 },
                    mobile: { width: 375, height: 667 }
                };
                const preset = viewportPresets[options.viewport.toLowerCase()];
                if (preset && !options.width && !options.height) {
                    options.width = preset.width;
                    options.height = preset.height;
                }
            }

            // Use the bot's authenticated session to take screenshot
            const screenshotBuffer = await fetchScreenshotWithSession(url.href, options, ctx);
            
            if (!screenshotBuffer || screenshotBuffer.length === 0) {
                throw new Error(`Unable to capture screenshot for the link: ${link}`);
            }

            log.info('getScreenshot', `Successfully captured screenshot (${screenshotBuffer.length} bytes)`);

            // Save to file if requested
            if (options.saveToFile) {
                const username = url.pathname.replace(/^\/|\/$/g, '') || 'facebook_profile';
                const filename = options.filename || username;
                const filePath = await saveScreenshot(screenshotBuffer, filename, options.format || 'png');
                log.info('getScreenshot', `Screenshot saved to: ${filePath}`);
                return filePath;
            }

            return screenshotBuffer;
        })()
        .then(result => callback(null, result))
        .catch(err => {
            log.error("getScreenshot", err);
            callback(err);
        });

        return returnPromise;
    };
};
