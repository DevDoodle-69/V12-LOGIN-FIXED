"use strict";

var log = require("npmlog");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isNetworkError(err) {
  if (!err) return false;
  const networkErrorCodes = [
    'ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET', 'ECONNREFUSED',
    'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'
  ];
  return networkErrorCodes.includes(err.code) || 
         networkErrorCodes.includes(err.errno) ||
         (err.errors && err.errors.some(e => networkErrorCodes.includes(e.code)));
}

async function retryRequest(requestFunc, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFunc();
    } catch (err) {
      lastError = err;
      
      if (!isNetworkError(err) || attempt === maxRetries) {
        throw err;
      }
      
      const delay = initialDelay * Math.pow(2, attempt);
      log.warn("retryRequest", `Network error (${err.code || err.errno}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

module.exports = retryRequest;
