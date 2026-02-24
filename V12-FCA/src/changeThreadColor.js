"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function changeThreadColor(color, threadID, callback) {
    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err) {
        if (err) return rejectFunc(err);
        resolveFunc(err);
      };
    }

    var validatedColor = color !== null ? color.toLowerCase() : color; // API only accepts lowercase letters in hex string
    // Validate that we have a theme ID
    if (!validatedColor || typeof validatedColor !== 'string') {
      throw { error: "Invalid theme ID provided." };
    }
    
    // Check if it's a predefined color from the whitelist
    var colorList = Object.keys(api.threadColors).map(function (name) {
      return api.threadColors[name];
    });
    var isStandardColor = colorList.includes(validatedColor);
    
    // Allow both standard colors and AI-generated themes
    // Only validate minimum length - Facebook API will reject invalid IDs
    if (!isStandardColor && validatedColor.length < 10) {
      throw { error: "The theme ID appears to be invalid. Use api.threadColors for standard colors." };
    }

    var form = {
      dpr: 1,
      queries: JSON.stringify({
        o0: {
          //This doc_id is valid as of January 31, 2020
          doc_id: "1727493033983591",
          query_params: {
            data: {
              actor_id: ctx.userID,
              client_mutation_id: "0",
              source: "SETTINGS",
              theme_id: validatedColor,
              thread_id: threadID
            }
          }
        }
      })
    };

    defaultFuncs
      .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resData) {
        if (resData[resData.length - 1].error_results > 0) throw resData[0].o0.errors;
        return callback();
      })
      .catch(function (err) {
        log.error("changeThreadColor", err);
        return callback(err);
      });

    return returnPromise;
  };
};
