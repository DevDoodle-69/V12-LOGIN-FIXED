"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
	/**
	 * Unified function to poke a user or get a list of pokes.
	 * @param {string|number|object} targetOrOptions - User ID to poke, or an options object.
	 * @param {boolean} [targetOrOptions.list=false] - Set to true to get the poke list.
	 * @param {number} [targetOrOptions.limit=10] - Number of pokes to retrieve.
	 * @param {string|null} [targetOrOptions.cursor=null] - Pagination cursor for poke list.
	 * @param {function} callback - The callback function.
	 */
	return function poke(targetOrOptions, callback) {
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

		let form;
		let actionType = ''; // 'poke' or 'getList'

		// Determine if we are poking a user or getting a list
		const targetType = utils.getType(targetOrOptions);
		if (targetType === 'String' || targetType === 'Number') {
			actionType = 'poke';
			form = {
				variables: JSON.stringify({
					input: {
						client_mutation_id: Math.round(Math.random() * 1024).toString(),
						actor_id: ctx.userID,
						user_id: targetOrOptions
					}
				}),
				doc_id: "29511440545169840",
				fb_api_caller_class: "RelayModern",
				fb_api_req_friendly_name: "PokesMutatorPokeMutation",
				server_timestamps: true
			};
		} else if (targetType === 'Object' && targetOrOptions.list) {
			actionType = 'getList';
			const limit = targetOrOptions.limit || 10;
			const cursor = targetOrOptions.cursor || null;
			form = {
				variables: JSON.stringify({
					count: limit,
					cursor: cursor,
					scale: 1
				}),
				doc_id: "31385547277727953",
				fb_api_caller_class: "RelayModern",
				fb_api_req_friendly_name: "PokesListPaginationQuery",
				server_timestamps: true
			};
		} else {
			const err = new Error("Invalid argument. Provide a userID to poke or an options object with { list: true } to get the poke list.");
			log.error("poke", err);
			return callback(err);
		}

		defaultFuncs
			.post("https://www.facebook.com/api/graphql/", ctx.jar, form)
			.then(utils.parseAndCheckLogin(ctx, defaultFuncs))
			.then(function(resData) {
				if (resData.errors) {
					throw resData.errors[0];
				}

				if (actionType === 'poke') {
					if (!resData.data || !resData.data.user_poke || resData.data.user_poke.user.poke_status !== "PENDING") {
						throw new Error("Poke failed. The user may have already been poked or has blocked pokes.");
					}
					callback(null, resData.data.user_poke);
				} else { // getList
					if (!resData.data || !resData.data.viewer || !resData.data.viewer.incoming_pokes) {
						throw new Error("Failed to get poke back list. The API may have changed.");
					}
					const pokes = resData.data.viewer.incoming_pokes.edges.map(edge => ({
						poker: edge.node.poker,
						description: edge.node.description.text,
						time: edge.node.time,
						cursor: edge.cursor
					}));
					const page_info = resData.data.viewer.incoming_pokes.page_info;
					callback(null, {
						pokes,
						page_info
					});
				}
			})
			.catch(function(err) {
				log.error("poke", err);
				return callback(err);
			});

		return returnPromise;
	};
};
