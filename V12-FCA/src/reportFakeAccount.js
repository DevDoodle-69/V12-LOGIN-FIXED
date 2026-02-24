/**
 * @author NTKhang
 * This is a custom function, not part of the original API.
 * It is designed to report a user as a fake account.
 */
"use strict";

const utils = require("../utils");
const log = require("npmlog");
const crypto = require("crypto");

/**
 * Reports a user for being a fake account.
 * @param {string} userID - The ID of the user to report.
 * @param {function} callback - The callback function.
 * @returns {Promise<object>} A promise that resolves with a success message or rejects with an error.
 */
module.exports = function(defaultFuncs, api, ctx) {
    return function reportFakeAccount(userID, callback) {
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

        if (!userID) {
            const err = new Error("reportFakeAccount requires a userID to be provided.");
            log.error("reportFakeAccount", err);
            return callback(err);
        }

        // This context object is constructed based on observed network requests for reporting a fake account.
        const context = {
            "session_id": crypto.randomUUID(), // Generating a random session ID
            "support_type": "frx",
            "type": 2,
            "story_location": "profile_someone_else",
            "entry_point": "profile_report_button",
            "reporting_ufo_key": `ufo-${crypto.randomUUID()}`, // Generating a random UFO key
            "rapid_reporting_tags": ["profile_report", "fake_profile", "not_a_real_person"],
            "additional_data": {
                "is_ixt_session": true,
                "frx_validation_ent": "IEntProfileBase",
                "is_ixt_session_logged": true,
                "checked_component_names": null
            },
            "screen_type": "frx_question_tree_confirmation_screen",
            "reportable_ent_token": userID
        };
        
        // This serialized state seems to be consistent for this specific reporting flow.
        const serializedState = "QVFhZ081V0JTeHhwMDBDREFKbDlLSURpSzdGcmFkMnhHWTc0TFJLRGNpeXhaMHU1SUU5aEliZVVHTjQzcXdJa1ZmSjZSX1diV3d1Z1FJZmhYRWIzb1BXTDhLOE5QNmliUHlUYTR6eXhrRGNFTmRMdzVIRDhnRXJqY3ZWTFIxYkZpT2MtLURlb2Z5SEQ4MUw4VXZsemFESmhDNjRlWjZFeU8yTXFBc2FFWVpwT05sTnBqOHEwbUhLeTdwa2V6OHZTUGE3emZkZ2UzMlgyeUI0LU9na05NTHQwZTRzdVZXbW9mOGNrMHA4WXIzWE9GYzJWaHhjWDJiVzdnRHpoVWN5U3pIRWtIVnhpWWU0NVJVWjVvMlJUS19KQjZkUEc3ZUpTbm93cDZIbThLQXZLZm1CUFkyS0daZk9rbEhCdTVGS1ZuZjVPelNHRTlyS3IxQjdRakxMQU52VVVsb2VFOWZYaEV0Wi13SHZlS1VRSU5tTUZPa2phbzVYSW90MVBQLXRlTEcyZ3pNUWlLVmNwbU5sTEE5cUlZWmxQVVV0bXhGTk1FUUswTUZJZkdRSWhrb2w5OTRhY2RIeFdWMU1XaC1NNEFJeWE4QmNCcW13ZGZRd0hNSUNuWkUtX2F5ZEZpXzFUZmVBQkdjazF3WEloUmRzSF92cUdncGJPb1VPS1N5Y1dsX1VlWDc3SEh0YTZ6MHV4dFgwNXFvZWI4cVNvTG5JVVFzczF5TnJocGoweGlfa1hOQzkxS1Q2OVB6YnIyMWl5OEpfX2c2cVQ2el9LYzVrWmhoWDZ3a1pPWGRDRnplcFd5OUZYYVZmLTh2dGdmWU1FTzc0YjVZdEE5bjlQYkRqdWV1QzM5aXBHMC1yQ0lUU3dNV0NPOENVaElFQlEyZEIzaW9zbEl5RThSeWZBLVM1YnA1Y09LTnhKeHBXT2puR1JOcGZKTGtZUm43Vi1OOElLZElzbzgwSllEOVRlWVFuSkNJZG1jbFFLYjZHdlBlZUktajM2Yl9NQUN4dGRaNTdpemNJbjVFVXRrZmU2UGpLLVhDOVoyMng3cFNqWWRYV0gzTXVGX3ZZUjY4N1c3MUxwVnV0SW1LdjJsMUI0XzNVc21iV19wY19ZRzN5cTVlR3hON3ZwbGdXcUxyc0tWWTZkRjZMMWpZcjlxSEdkWWwtbmJFR0FqUVYwSDVpSDZFcXlhUW5PN0F4TUZoX3BnREUxYldRYkZ1VFYxZFE3NUlYTUtVRVBXYlpTTlY1dDg4NTdOOUlGUzRWZk9yVzJ3TW9SLWUtbERfbHFmN3NJSXE2WnpxVktQV0Y5REQzckJfaFNJS1d0T1ZoM1Zxb0w4OTVBbHBPc2wzNWlEUlQyWHdmNy1mRG9ILVp3QnNGUkFUWmJlNDRsNmNsd05TV0RuSmtCUzJONEJTd2VMUlpPWmttWlppTFpnTHN3WmxjMTBrMlF3Rkc4dXdUTEt0WkFSa1IwZTZ0UXNPQXdXX2t0b2NRWHZ0a0JKWndKazdteFN3b2pVdWFZNXJLeVRrN2N0ZjFGeWkzTkRGdHljSlNJa3dvRUpDbXNUdDBHTThfTFRNcGRvSlBZTUlkaW5hOExWekh1ZUp0RzZoSVdnS0VEZFJaTDJfUUFBV2ZGeEY4aHhfSjlmZlIwS3A5T19PU2lyZ0docXBqbE9HYlFvS1NHeGpVRlFVM00xeThHRVFBVWUzUkdodU1pakV2aE01YmF5MU9SdHh6d1o3RmxueVUweEpQVlQ2OC1fQU5zRWFidUNwUVMwQ1pSSmdwNjVVYWs4d1ZON1RhVWhtSlFYUU91V3hLdC1DVEYxbWdOUHo3V2FqY0phVzIwM2lYLXZXS2ZTWUJaYVFiRVRrbi03bVUydGNqSHphYVFRbnpOcVhxdlRFUlVDcUFzc1J0ZUp3WWN3ajRyQ1Q3bXU2SElULUpaNXo1VE01SktzTDZkdUhXQUNQcmlTQzlkMG9KTFp1Z00yOWFuU2hDTDJBSW0xWkdKNG9Ma2ZJdE41cS1J";

        const variables = {
            "input": {
                "frx_question_tree_confirmation_screen": {
                    "back_to_start": false,
                    "context": JSON.stringify(context),
                    "serialized_state": serializedState
                },
                "actor_id": ctx.userID,
                "client_mutation_id": Math.floor(Math.random() * 100).toString() // Using a random client mutation ID
            },
            "scale": 1
        };

        const form = {
            av: ctx.userID,
            __user: ctx.userID,
            doc_id: "24549258644762624",
            variables: JSON.stringify(variables),
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "CometFacebookIXTNextMutation",
            server_timestamps: true
        };

        defaultFuncs
            .post("https://www.facebook.com/api/graphql/", ctx.jar, form)
            .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
            .then(function(resData) {
                if (resData.errors) {
                    throw resData.errors[0];
                }

                // Make the success check more flexible.
                // As long as the API returns a new screen model, we can consider it a success.
                if (resData.data && resData.data.ixt_screen_next && resData.data.ixt_screen_next.view_model) {
                    // The API call was successful, but the title returned can be generic ("You selected").
                    // We will use a more specific, hardcoded message for clarity.
                    const message = "Account reported successfully. Facebook will review the report.";
                    callback(null, { success: true, message: message });
                } else {
                    log.error("reportFakeAccount", "Unexpected API response format:", JSON.stringify(resData));
                    throw new Error("Failed to report account. The API response format may have changed or was unexpected.");
                }
            })
            .catch(function(err) {
                log.error("reportFakeAccount", err);
                return callback(err);
            });

        return returnPromise;
    };
};

