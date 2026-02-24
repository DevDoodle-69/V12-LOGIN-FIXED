"use strict";

const utils = require("../utils");
const log = require("npmlog");

/**
 * Extracts user ID from Facebook profile URL
 * @param {string} profileUrl - The Facebook profile URL (e.g., "/rich.raj.gaming" or full URL)
 * @returns {string} - Clean path for the profile
 */
function normalizeProfilePath(profileUrl) {
    if (!profileUrl) return null;

    // Remove protocol and domain if present
    let path = profileUrl.replace(/^https?:\/\/[^\/]+/, '');

    // Ensure it starts with a slash
    if (!path.startsWith('/')) {
        path = '/' + path;
    }

    // Remove trailing slashes
    path = path.replace(/\/+$/, '');

    return path;
}

module.exports = function(defaultFuncs, api, ctx) {
    return function getUID(profileUrl, callback) {
        let resolveFunc = function() {};
        let rejectFunc = function() {};
        const returnPromise = new Promise(function(resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
            callback = function(err, data) {
                if (err) {
                    return rejectFunc(err);
                }
                resolveFunc(data);
            };
        }

        if (!profileUrl) {
            const err = new Error("getUID requires a profile URL to be provided.");
            log.error("getUID", err);
            return callback(err);
        }

        const normalizedPath = normalizeProfilePath(profileUrl);

        if (!normalizedPath || normalizedPath === '/') {
            const err = new Error("Invalid profile URL provided.");
            log.error("getUID", err);
            return callback(err);
        }

        const form = {
            route_urls: JSON.stringify([normalizedPath]),
            routing_namespace: "fb_comet",
            __aaid: "0",
            __user: ctx.userID || "0",
            __a: "1",
            __req: "1",
            __hs: "20356.HYP:comet_pkg.2.1...0",
            dpr: "1",
            __ccg: "GOOD",
            __rev: "1027588029",
            __comet_req: "15",
            fb_dtsg: ctx.fb_dtsg || "NAcOQYjCqAXLhPx4p4V4p4V4p4V4p4V4p4V4p4V4p4V4p4V4p4V4p4V",
            jazoest: "25310",
            lsd: ctx.lsd || "S29ndZpBAPmAUr6IQElpmx"
        };

        // Add dynamic parameters if available in context
        if (ctx.__dyn) form.__dyn = ctx.__dyn;
        if (ctx.__spin_r) form.__spin_r = ctx.__spin_r;
        if (ctx.__spin_b) form.__spin_b = ctx.__spin_b;
        if (ctx.__spin_t) form.__spin_t = ctx.__spin_t;
        if (ctx.__crn) form.__crn = ctx.__crn;

        defaultFuncs
            .post("https://www.facebook.com/ajax/bulk-route-definitions/", ctx.jar, form)
            .then(function(resData) {
                try {
                    // FIX: The error "resData.replace is not a function" indicates
                    // that resData is already a parsed JSON object. The HTTP client
                    // handles stripping "for (;;);" and parsing automatically.
                    const data = resData;

                    if (!data.payload || !data.payload.payloads) {
                        throw new Error("Invalid response structure from Facebook API.");
                    }

                    const routeData = data.payload.payloads[normalizedPath];

                    if (!routeData || !routeData.result) {
                        throw new Error(`Profile not found or inaccessible: ${profileUrl}`);
                    }

                    if (routeData.error) {
                        throw new Error(`Facebook API error for profile: ${profileUrl}`);
                    }

                    const rootView = routeData.result.rootView;
                    if (!rootView || !rootView.props) {
                        throw new Error("Could not extract user information from profile data.");
                    }

                    const userID = rootView.props.userID;
                    const vanity = rootView.props.userVanity;
                    const viewerID = rootView.props.viewerID;

                    if (!userID) {
                        throw new Error("User ID not found in profile data.");
                    }

                    const result = {
                        id: userID,
                        vanity: vanity,
                        viewerID: viewerID,
                        url: `https://facebook.com${normalizedPath}`,
                        profileUrl: normalizedPath
                    };

                    callback(null, result);
                } catch (err) {
                    log.error("getUID", "Failed to process the response object.", err);
                    return callback(err);
                }
            })
            .catch(function(err) {
                log.error("getUID", err);
                return callback(err);
            });

        return returnPromise;
    };
};
