
const axios = require('axios');
const logger = require('../logger');

class GenderDetector {
    constructor() {
        this.genderCache = new Map();
        this.maleIndicators = [
            'boy', 'man', 'male', 'guy', 'dude', 'bro', 'king', 'prince', 'father', 'dad', 'papa',
            'mr', 'mister', 'sir', 'gentleman', 'husband', 'boyfriend', 'son', 'uncle', 'brother',
            'mohammad', 'ahmed', 'ali', 'hassan', 'omar', 'khalid', 'fahim', 'rafi', 'sakib',
            'rahim', 'karim', 'ibrahim', 'mahmud', 'rashid', 'tanvir', 'arif', 'sabbir'
        ];
        this.femaleIndicators = [
            'girl', 'woman', 'female', 'lady', 'princess', 'queen', 'mother', 'mom', 'mama',
            'mrs', 'miss', 'ms', 'madam', 'wife', 'girlfriend', 'daughter', 'aunt', 'sister',
            'fatima', 'ayesha', 'khadija', 'zara', 'sara', 'nadia', 'sadia', 'rashida',
            'nasreen', 'sultana', 'begum', 'rashida', 'shireen', 'rehana', 'ruma', 'ruma'
        ];
    }

    async detectGender(api, userId) {
        try {
            // Check cache first
            if (this.genderCache.has(userId)) {
                return this.genderCache.get(userId);
            }

            // Get user info from Facebook
            const userInfo = await new Promise((resolve, reject) => {
                api.getUserInfo(userId, (err, info) => {
                    if (err) reject(err);
                    else resolve(info[userId]);
                });
            });

            if (!userInfo) {
                logger.warn(`Could not get user info for ${userId}`);
                return 'unknown';
            }

            const name = userInfo.name || '';
            const profileUrl = userInfo.profileUrl || '';
            
            // Analyze name for gender indicators
            const nameLower = name.toLowerCase();
            const gender = this.analyzeNameForGender(nameLower);

            // Cache the result
            this.genderCache.set(userId, gender);
            
            logger.info(`Detected gender for ${name} (${userId}): ${gender}`);
            return gender;

        } catch (error) {
            logger.error(`Gender detection failed for ${userId}: ${error.message}`);
            return 'unknown';
        }
    }

    analyzeNameForGender(nameLower) {
        // Check for explicit male indicators
        for (const indicator of this.maleIndicators) {
            if (nameLower.includes(indicator)) {
                return 'male';
            }
        }

        // Check for explicit female indicators
        for (const indicator of this.femaleIndicators) {
            if (nameLower.includes(indicator)) {
                return 'female';
            }
        }

        // Additional name-based analysis
        // Common male name endings
        if (nameLower.endsWith('ul') || nameLower.endsWith('ur') || 
            nameLower.endsWith('ad') || nameLower.endsWith('an') ||
            nameLower.endsWith('in') || nameLower.endsWith('ar')) {
            return 'male';
        }

        // Common female name endings
        if (nameLower.endsWith('a') || nameLower.endsWith('i') || 
            nameLower.endsWith('ara') || nameLower.endsWith('iya') ||
            nameLower.endsWith('een') || nameLower.endsWith('ana')) {
            return 'female';
        }

        return 'unknown';
    }

    getGenderFromCache(userId) {
        return this.genderCache.get(userId) || 'unknown';
    }

    clearCache() {
        this.genderCache.clear();
    }
}

module.exports = new GenderDetector();
