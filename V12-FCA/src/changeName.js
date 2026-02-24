"use strict";

const utils = require("../utils");
const log = require("npmlog");

/**
 * Handles the response from the name change GraphQL mutation.
 * @param {object} resData - The raw response data from the API.
 * @returns {object} The UI response data from the API.
 */
function handleResponse(resData) {
	if (resData.errors) {
		throw resData.errors[0];
	}
	const updateData = resData.data?.fxim_update_identity_name;
	if (!updateData) {
		throw new Error("API response is not in the expected format. It may have changed.");
	}
	if (updateData.error) {
		// The API itself can return a structured error object
		throw new Error(`API returned an error: ${updateData.error.message || "Unknown error"}`);
	}
	return updateData.ui_response;
}


module.exports = function(defaultFuncs, api, ctx) {
	/**
	 * Changes the account name for a given identity ID.
	 * @param {string} identityID - The user/profile ID to change the name for.
	 * @param {object} newName - An object containing the new name components.
	 * @param {string} newName.first - The new first name.
	 * @param {string} [newName.middle=""] - The new middle name (optional).
	 * @param {string} newName.last - The new last name.
	 * @param {function} callback - The callback function to handle the response.
	 */
	return function changeAccountName(identityID, newName, callback) {
		let resolveFunc = function() {};
		let rejectFunc = function() {};
		const returnPromise = new Promise(function(resolve, reject) {
			resolveFunc = resolve;
			rejectFunc = reject;
		});

		if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
			callback = (err, data) => {
				if (err) {
					return rejectFunc(err);
				}
				resolveFunc(data);
			};
		}

		if (!identityID || !newName || !newName.first || !newName.last) {
			const err = new Error("identityID and newName object with 'first' and 'last' properties are required.");
			log.error("changeAccountName", err);
			return callback(err);
		}

		// Construct the full name from the provided parts
		const fullName = [newName.first, newName.middle, newName.last]
			.filter(Boolean) // Remove empty or null parts
			.join(" ");

		const variables = {
			client_mutation_id: utils.generateClientMutationID(), // Assuming a utility function to generate this
			family_device_id: "device_id_fetch_datr",
			identity_ids: [identityID.toString()],
			full_name: fullName,
			first_name: newName.first,
			middle_name: newName.middle || "",
			last_name: newName.last,
			"interface": "FB_WEB"
		};

		const form = {
			doc_id: "9538143859625836",
			variables: JSON.stringify(variables),
			fb_api_caller_class: "RelayModern",
			fb_api_req_friendly_name: "useFXIMUpdateNameMutation",
			server_timestamps: true
		};

		defaultFuncs
			.post("https://accountscenter.facebook.com/api/graphql/", ctx.jar, form, {
                "Referer": `https://accountscenter.facebook.com/profiles/${identityID}/name`,
            })
			.then(utils.parseAndCheckLogin(ctx, defaultFuncs))
			.then(resData => {
				const result = handleResponse(resData);
				callback(null, result);
			})
			.catch(err => {
				log.error("changeAccountName", err);
				return callback(err);
			});

		return returnPromise;
	};
};
