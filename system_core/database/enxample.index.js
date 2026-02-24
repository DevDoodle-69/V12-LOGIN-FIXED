const { MongoClient } = require('mongodb');
const logger = require('../logger');

const uri = "mongodb+srv://catbot:khusivabi@cluster0.quk1rri.mongodb.net/GoatBotV2?retryWrites=true&w=majority&appName=Cluster0"; // Replace with your MongoDB URL
const client = new MongoClient(uri);

async function connect() {
    try {
        await client.connect();
        logger.info('Connected to MongoDB');
        return client.db('nexasim');
    } catch (err) {
        logger.error(`Failed to connect to MongoDB: ${err.message}`);
        process.exit(1);
    }
}

module.exports = { connect };