
const logger = require('../logger');

async function ensureUser(db, userId) {
    const usersCollection = db.collection('users');
    let user = await usersCollection.findOne({ userId });

    if (!user) {
        user = {
            userId,
            balance: 0,
            rank: 1,
            xp: 0,
            ban: false,
            messageCounts: {}, // { threadId: count }
            data: {
                detectedGender: 'unknown',
                genderConfirmed: false,
                lastPairing: null,
                pairingHistory: []
            }
        };
        await usersCollection.updateOne({ userId }, { $set: user }, { upsert: true });
        logger.info(`Added new user to database: ${userId}`);
    }

    return user;
}

async function updateUserMessageCount(db, userId, threadId) {
    const usersCollection = db.collection('users');
    const user = await ensureUser(db, userId);

    const messageCounts = user.messageCounts || {};
    messageCounts[threadId] = (messageCounts[threadId] || 0) + 1;

    const xpGain = 10; // 10 XP per message
    const newXp = (user.xp || 0) + xpGain;
    const newRank = Math.floor(newXp / 100) + 1; // Rank up every 100 XP

    await usersCollection.updateOne(
        { userId },
        { $set: { messageCounts, xp: newXp, rank: newRank } }
    );

    logger.verbose(`Updated user ${userId} in thread ${threadId}: Messages=${messageCounts[threadId]}, XP=${newXp}, Rank=${newRank}`);
}

module.exports = { ensureUser, updateUserMessageCount };
