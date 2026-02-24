const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DB_FILE = path.join(__dirname, 'local_db.json');

const defaultDB = {
    users: [],
    settings: [],
    threads: [],
    botSettings: []
};

let db = null;

function ensureDBFile() {
    if (!fs.existsSync(DB_FILE) || fs.readFileSync(DB_FILE, 'utf8').trim() === '') {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2));
    }
}

function loadDB() {
    ensureDBFile();
    try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(fileContent);
    } catch (err) {
        logger.error(`Error parsing JSON from ${DB_FILE}. Recreating with default data.`);
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2));
        return defaultDB;
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function collection(collectionName) {
    ensureDBFile();
    if (!db) {
        db = loadDB();
    }
    
    if (!db[collectionName]) {
        db[collectionName] = [];
    }

    return {
        find: (query = {}) => {
            return Promise.resolve(db[collectionName]);
        },
        findOne: (query = {}) => {
            const items = db[collectionName];
            const item = items.find(item => {
                return Object.keys(query).every(key => item[key] === query[key]);
            });
            return Promise.resolve(item || null);
        },
        updateOne: (query, update, options = {}) => {
            const index = db[collectionName].findIndex(item => {
                return Object.keys(query).every(key => item[key] === query[key]);
            });

            if (index === -1 && options.upsert) {
                const newItem = { ...query, ...update.$set };
                db[collectionName].push(newItem);
            } else if (index !== -1) {
                db[collectionName][index] = { ...db[collectionName][index], ...update.$set };
            }
            
            saveDB(db);
            return Promise.resolve({ acknowledged: true });
        }
    };
}

async function connect() {
    try {
        if (!db) {
            db = loadDB();
        }
        logger.info('Connected to local JSON database');
        return { collection };
    } catch (err) {
        logger.error(`Database connection error: ${err.message}`);
        throw err;
    }
}

async function close() {
    if (db) {
        saveDB(db);
        db = null;
    }
}

module.exports = { connect, close };
