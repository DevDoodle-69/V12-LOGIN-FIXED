"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  /**
   * Generates an AI-powered theme and returns its details.
   *
   * @param {string} prompt The text prompt to generate the theme from.
   * @param {string} threadID The ID of the thread (context for generation).
   * @param {function} callback Optional callback function which receives (err, themeData).
   */
  return function generateAiTheme(prompt, threadID, callback) {
    var resolveFunc = function () {};
    var rejectFunc = function () {};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, themeData) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(themeData);
      };
    }
    
    // This function will now only generate the theme and return its details.
    var generationForm = {
      av: ctx.userID,
      __user: ctx.userID,
      __a: 1,
      dpr: 1,
      __comet_req: 15,
      fb_dtsg: ctx.fb_dtsg,
      jazoest: ctx.jazoest,
      lsd: ctx.lsd,
      __spin_r: ctx.spin_r,
      __spin_b: ctx.spin_b,
      __spin_t: ctx.spin_t,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "useGenerateAIThemeMutation",
      variables: JSON.stringify({
        input: {
          client_mutation_id: Math.floor(Math.random() * 10).toString(),
          actor_id: ctx.userID,
          bypass_cache: true,
          caller: "MESSENGER",
          num_themes: 1,
          prompt: prompt,
          thread_id: threadID
        },
      }),
      server_timestamps: true,
      doc_id: "23873748445608673",
    };

    defaultFuncs
      .post("https://www.facebook.com/api/graphql/", ctx.jar, generationForm)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resData) {
        if (resData && resData.errors) {
          throw resData.errors;
        }

        var result = resData.data.xfb_generate_ai_themes_from_prompt;
        if (!result || !result.success || !result.themes || result.themes.length === 0) {
          throw new Error("Failed to generate AI theme. The response from the server was invalid.");
        }
        
        var themeData = result.themes[0];
        if (!themeData || !themeData.id) {
            throw new Error("Could not find a valid theme in the server response.");
        }

        // Return the theme data in the callback instead of applying it.
        return callback(null, themeData);
      })
      .catch(function (err) {
        log.error("generateAiTheme", "Error during theme generation:", err);
        return callback(err);
      });

    return returnPromise;
  };
};

