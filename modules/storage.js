'use strict';

const META = {
    author: "Wolvan",
    name: "StorageAdapter",
    description: "Get and store data.",
    version: "1.0.0"
};

const Promise = require("bluebird");

class StorageAdapter {
    get() {
        return new Promise.resolve(null);
    }
    set() {
        return new Promise.resolve();
    }
    list() {
        return new Promise.resolve([]);
    }
    delete() {
        return new Promise.resolve();
    }
    clear() {
        return new Promise.resolve();
    }
}

module.exports = StorageAdapter;
module.exports.META = META;
