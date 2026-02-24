"use strict";

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { JSDOM } = require("jsdom");

module.exports = function(defaultFuncs, api, ctx) {
    // Define the function to be attached to the api object
    async function getCoverUrl(targetID) {
        try {
            // Get cookies from fbstate or account.txt
            let cookies;
            try {
                const PROJECT_ROOT = path.resolve(__dirname, "../..");
                const ACCOUNT_FILE = path.join(PROJECT_ROOT, "account.txt");
                const rawData = fs.readFileSync(ACCOUNT_FILE, "utf8");
                const fbstate = JSON.parse(rawData);
                
                if (Array.isArray(fbstate)) {
                    cookies = fbstate.map(c => `${c.key}=${c.value}`).join("; ");
                } else {
                    cookies = rawData.trim();
                }
            } catch (err) {
                console.error(`Error loading cookies: ${err.message}`);
                if (ctx && ctx.jar) {
                    const cookieString = ctx.jar.getCookieString('https://www.facebook.com');
                    if (cookieString) {
                        cookies = cookieString;
                    }
                }
                if (!cookies) {
                    throw new Error("Failed to load cookies from account.txt and no session cookies available");
                }
            }

            const profileUrl = `https://www.facebook.com/profile.php?id=${targetID}`;
            console.log(`⏳ Fetching cover photo for profile ID: ${targetID}...`);

            const requestOptions = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
                    'Cookie': cookies,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://www.facebook.com/',
                    'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1'
                },
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 400;
                }
            };

            const response = await axios.get(profileUrl, requestOptions);
            
            const dom = new JSDOM(response.data);
            const document = dom.window.document;

            const coverImageElement = document.querySelector('img[data-imgperflogname="profileCoverPhoto"]');
            
            if (!coverImageElement || !coverImageElement.src) {
                throw new Error("Couldn't find cover photo for this user.");
            }

            const coverImageURL = coverImageElement.src;
            console.log(`✅ Found cover image URL: ${coverImageURL}`);
            
            return coverImageURL;
        } catch (err) {
            console.error("❌ Error in getCoverUrl function:", err.message);
            if (err.response) {
                console.error(`HTTP Status: ${err.response.status}`);
            }
            throw err;
        }
    }

    // This is the important part - proper method attachment to the API object
    return function attachGetCoverUrl(targetID) {
        // For backward compatibility support both promise and callback styles
        if (typeof targetID !== "string" && typeof targetID !== "number") {
            throw new TypeError("getCoverUrl: targetID must be a string or number");
        }
        
        // Return a promise that resolves with the URL
        return getCoverUrl(targetID);
    };
};
