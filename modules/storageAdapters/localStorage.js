'use strict';

const META = {
    author: "Wolvan",
    name: "StorageAdapter:localStorage",
    description: "Get and store data based on localStorage.",
    version: "1.0.0"
};

const persist = require("node-persist");
const StorageAdapter = require("../storage.js");

const storage = new WeakMap();

class LocalStorageAdapter extends StorageAdapter {
    constructor(storageOptions) {
        super();
        let store = persist.create(storageOptions);
        store.initSync();
        storage.set(this, store);
    }
    get(key) {
        return storage.get(this).getItem(key);
    }
    set(key, value, options) {
        return storage.get(this).setItem(key, value, options);
    }
    list() {
        return new Promise.resolve(storage.get(this).keys());
    }
    delete(key) {
        return storage.get(this).removeItem(key);
    }
    clear() {
        return storage.get(this).clear();
    }
}

module.exports = LocalStorageAdapter;
module.exports.META = META;
