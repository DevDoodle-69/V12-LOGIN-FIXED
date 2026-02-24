"use strict";

const utils = require("../utils");
const log = require("npmlog");

/**
 * Generates a version 4 UUID (Universally Unique Identifier).
 * @returns {string} A new UUID.
 */
function generateUUID() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

/**
 * A list of common report types.
 * Note: This list may not be exhaustive and is based on common platform categories.
 */
const ReportTypes = {
	HATE_SPEECH: "HATE_SPEECH",
	SPAM: "SPAM", 
	NUDITY_OR_SEXUAL_ACTIVITY: "NUDITY_OR_SEXUAL_ACTIVITY",
	HARASSMENT: "HARASSMENT",
	VIOLENCE: "VIOLENCE",
	FALSE_INFORMATION: "FALSE_INFORMATION",
	UNAUTHORIZED_SALES: "UNAUTHORIZED_SALES",
	SCAM_OR_FRAUD: "SCAM_OR_FRAUD"
};

module.exports = function(defaultFuncs, api, ctx) {
	/**
	 * Reports a specific message in a thread as harmful.
	 * @param {string} messageID The ID of the message to report.
	 * @param {string} threadID The ID of the thread containing the message.
	 * @param {string} reportType The category of the report (e.g., "HATE_SPEECH"). See ReportTypes for common values.
	 * @param {function} callback Optional callback function.
	 * @returns {Promise<object>} A promise that resolves with the confirmation response from the server.
	 */
	return function reportMessage(messageID, threadID, reportType, callback) {
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

		if (!messageID || !threadID || !reportType) {
			const err = new Error("reportMessage requires messageID, threadID, and reportType to be provided.");
			log.error("reportMessage", err);
			return callback(err);
		}

		// Validate report type
		if (!Object.values(ReportTypes).includes(reportType)) {
			const err = new Error(`Invalid report type: ${reportType}. Valid types are: ${Object.values(ReportTypes).join(', ')}`);
			log.error("reportMessage", err);
			return callback(err);
		}

		// Generate session ID and UFO key
		const sessionId = generateUUID();
		const ufoKey = `ufo-${generateUUID()}`;

		// This token is a Base64 encoded string identifying the thread entity.
		const reportableEntToken = Buffer.from(`EntMessengerViewerGroupThreadBase:${threadID}`).toString('base64');

		const context = {
			session_id: sessionId,
			support_type: "frx",
			type: 1, // Added type field that was in the working example
			story_location: "messenger_group_thread_details",
			entry_point: "report_long_press",
			reporting_ufo_key: ufoKey,
			reportable_ent_token: reportableEntToken,
			responsible_id: 0,
			reported_message_data: {
				selected_message_ids: [messageID],
				reported_conversation: [
					[messageID]
				]
			},
			additional_data: {
				"conformed_interface_override": null
			},
			responsibles_with_ufo_report_event_published: ""
		};

		const variables = {
			input: {
				frx_tag_selection_screen: {
					context: JSON.stringify(context),
					show_tag_search: false,
					tag_node_ids: [],
					tags: [reportType]
				},
				actor_id: ctx.userID,
				client_mutation_id: Math.floor(Math.random() * 100).toString()
			},
			scale: 1
		};

		const form = {
			doc_id: "25257920023810406",
			variables: JSON.stringify(variables),
			fb_api_caller_class: "RelayModern",
			fb_api_req_friendly_name: "useCIXNextScreenMutation"
		};

		// Add additional headers that might be required
		const headers = {
			'content-type': 'application/x-www-form-urlencoded',
			'x-fb-friendly-name': 'useCIXNextScreenMutation'
		};

		defaultFuncs
			.post("https://www.facebook.com/api/graphql/", ctx.jar, form, null, headers)
			.then(utils.parseAndCheckLogin(ctx, defaultFuncs))
			.then(function(resData) {
				if (resData.errors) {
					throw resData.errors[0];
				}

				if (!resData.data) {
					throw new Error("No data in response. API response structure may have changed.");
				}

				// Check for different possible response structures
				if (resData.data.cix_screen_next && resData.data.cix_screen_next.view_model) {
					const confirmation = resData.data.cix_screen_next.view_model;

					const result = {
						success: true,
						confirmationTitle: confirmation.title?.text || "Report submitted",
						confirmationSubtitle: confirmation.subtitle?.text || "Thank you for your report",
						actions: confirmation.actions ? confirmation.actions.map(action => ({
							id: action.id,
							type: action.type,
							title: action.title?.text || "",
							subtitle: action.subtitle?.text || ""
						})) : []
					};

					callback(null, result);
				} else {
					// If the structure is different, still consider it a success
					// but provide generic confirmation
					const result = {
						success: true,
						confirmationTitle: "Report submitted successfully",
						confirmationSubtitle: "Your report has been received and will be reviewed.",
						actions: [],
						rawResponse: resData.data // Include raw response for debugging
					};

					callback(null, result);
				}
			})
			.catch(function(err) {
				log.error("reportMessage", err);
				
				// Provide more detailed error information
				if (err.code === 1675030) {
					const detailedError = new Error(`Facebook API Error: ${err.description || 'Query Error'}. This might be due to invalid message ID, thread ID, or insufficient permissions.`);
					detailedError.originalError = err;
					detailedError.fbtrace_id = err.fbtrace_id;
					detailedError.www_request_id = err.www_request_id;
					return callback(detailedError);
				}
				
				return callback(err);
			});

		return returnPromise;
	};
};
