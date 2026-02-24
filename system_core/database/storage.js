
const { connect } = require('./index');

class Storage {
    constructor() {
        this.db = null;
    }

    async init() {
        this.db = await connect();
    }

    async getCollection(name) {
        if (!this.db) await this.init();
        return this.db.collection(name);
    }
}

module.exports = new Storage();
