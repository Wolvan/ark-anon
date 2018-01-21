'use strict';

const META = {
    author: "Wolvan",
    name: "StorageAdapter:memory",
    description: "Get and store data in memory. Not persistant.",
    version: "1.0.0"
};

const Promise = require("bluebird");
const StorageAdapter = require("../storage.js");

const storage = new WeakMap();

class MemoryStorageAdapter extends StorageAdapter {
    constructor() {
        super();
        storage.set(this, {});
    }
    get(key) {
        return new Promise.resolve(storage.get(this)[key]);
    }
    set(key, value) {
        let store = storage.get(this);
        store[key] = value;
        storage.set(this, store);
        return new Promise.resolve(true);
    }
    list() {
        return new Promise.resolve(Object.keys(storage.get(this)));
    }
    delete(key) {
        let store = storage.get(this);
        delete store[key];
        storage.set(this, store);
        return new Promise.resolve(true);
    }
    clear() {
        storage.set(this, {});
        return new Promise.resolve(true);
    }
}

module.exports = MemoryStorageAdapter;
module.exports.META = META;
