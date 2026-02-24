"use strict";

const utils = require("../utils");
const log = require("npmlog");

/**
 * Formats the raw video data from the GraphQL response to extract download URLs and other info.
 * @param {object} node - The raw story node object from the API response.
 * @returns {object|null} A formatted object with video details, caption, and download links, or null if invalid.
 */
function formatVideoResponse(node) {
    if (!node) {
        return null;
    }
    const media = node.attachments?.[0]?.media;
    if (!media || !media.id) {
        return null;
    }

    const delivery = media.videoDeliveryResponseFragment?.videoDeliveryResponseResult;
    if (!delivery) {
        return null;
    }

    // Extract progressive (direct download) URLs for different qualities
    const progressiveUrls = (delivery.progressive_urls || []).reduce((acc, curr) => {
        if (curr.progressive_url && curr.metadata?.quality) {
            acc[curr.metadata.quality.toLowerCase()] = curr.progressive_url;
        }
        return acc;
    }, {});

    return {
        videoID: media.id,
        caption: node.message?.text || null,
        shareableURL: media.shareable_url,
        permalink: media.permalink_url,
        durationSeconds: media.length_in_second,
        thumbnail: media.preferred_thumbnail?.image?.uri,
        height: media.height,
        width: media.width,
        downloads: {
            sd: progressiveUrls.sd || null,
            hd: progressiveUrls.hd || null,
            // The DASH manifest is for adaptive streaming, not a direct download, but can be useful.
            dashManifest: delivery.dash_manifests?.[0]?.manifest_xml || null
        }
    };
}


module.exports = function(defaultFuncs, api, ctx) {
    /**
     * @param {string} videoID - The ID of the video or Reel to fetch.
     * @param {function} callback - The callback function.
     */
    return function getVideoDownloadURL(videoID, callback) {
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

        if (!videoID || typeof videoID !== 'string') {
            const err = new Error("getVideoDownloadURL requires a valid videoID to be provided.");
            log.error("getVideoDownloadURL", err);
            return callback(err);
        }

        const variables = {
            "count": 5,
            "cursor": null,
            "scale": 1,
            "useDefaultActor": false,
            "video_feed_context_data": {
                "arltw_feed_section_type": "FB_SHORTS_CHAINING",
                "in_session_watched_video": null,
                "is_async_ads_enabled": true,
                "is_async_ads_headload_coupling_enabled": true,
                "player_behavior": "UNIFIED_PLAYER_VDD",
                "real_time_ranking_context_data": {
                    "recent_vpvs_v2": []
                },
                "request_type": "NORMAL",
                "seed_video_id": videoID,
                "shorts_search_params": {},
                "surface_type": "FEED_VIDEO_DEEP_DIVE",
                "tracking_code": "",
                "video_channel_entry_point": "NEWSFEED",
                "client_viewer_session_id": Math.random().toString(36).substring(2, 15)
            },
            "__relay_internal__pv__FBUnifiedVideo_defer_thumbnailrelayprovider": false,
            "__relay_internal__pv__FBUnifiedVideoMediaFooter_comet_enable_reels_ads_gkrelayprovider": true,
            "__relay_internal__pv__FBUnifiedVideoMediaFooter_community_notes_reels_fb_web_unified_gkrelayprovider": true,
            "__relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider": false,
            "__relay_internal__pv__FBUnifiedVideo_enable_reel_music_metadatarelayprovider": true
        };

        const form = {
            doc_id: "31852854384305619",
            variables: JSON.stringify(variables),
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "FBUnifiedVideoContainerQuery",
            server_timestamps: true
        };

        defaultFuncs
            .post("https://www.facebook.com/api/graphql/", ctx.jar, form)
            .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
            .then(function(resData) {
                if (resData.errors) {
                    throw resData.errors[0];
                }
                
                const edges = resData.data?.viewer?.video_feed_unit_feed?.edges;

                if (!edges) {
                    throw new Error("API response structure has changed. Expected 'video_feed_unit_feed.edges'.");
                }

                if (edges.length === 0) {
                    throw new Error(`API returned an empty feed for video ID ${videoID}. The video may be private, deleted, or region-locked.`);
                }
                
                const videoNode = edges[0].node;
                const formattedVideo = formatVideoResponse(videoNode);

                if (!formattedVideo) {
                    throw new Error("Could not parse video information from the response.");
                }

                callback(null, formattedVideo);
            })
            .catch(function(err) {
                log.error("getVideoDownloadURL", `Failed to get download URL for video ${videoID}: ${err.message || err}`);
                return callback(err);
            });

        return returnPromise;
    };
};

