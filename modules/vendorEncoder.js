'use strict';

const META = {
    author: "Wolvan",
    name: "vendorEncode",
    description: "Take an Ark Address and converts it to an encrypted string",
    version: "1.0.0"
};
const mappingVersion = "1";

const crypto = require("crypto");

const keys = new WeakMap();
const storage = new WeakMap();

function decodeAddress(enc, pass) {
    try {
        var decipher = crypto.createDecipher("aes-256-cbc", pass);
        var plain = decipher.update(enc, "hex", "utf8");
        plain += decipher.final("utf8");
        return plain;
    } catch (e) {
        return null;
    }
}

function encodeAddress(address, pass) {
    var cipher = crypto.createCipher("aes-256-cbc", pass);
    var crypted = cipher.update(address, "utf8", "hex");
    crypted = crypted += cipher.final("hex");
    return crypted;
}

class VendorEncoder {
    constructor(store, aesKey = null) {
        storage.set(this, store);
        keys.set(this, aesKey);

        this.decodeByVersion = {
            "0": (payload) => {
                return Promise.resolve(payload);
            },
            "1": (payload) => new Promise((resolve, reject) => {
                storage.get(this).get("addressV1Mappings").then((result) => {
                    let res = result || {};
                    if (res[payload]) resolve(res[payload]);
                    else reject(null);
                }).catch((err) => reject(err));
            })
        };
    }

    initKeys() {
        return new Promise((resolve) => {
            if (!keys.get(this)) storage.get(this).get("aesKey").then((result) => {
                let aesKey = null;
                if (result) aesKey = result;
                else aesKey = crypto.randomBytes(128).toString('hex');
                keys.set(this, aesKey);
                storage.get(this).set("aesKey", aesKey);
                resolve();
            }).catch(() => {
                let aesKey = crypto.randomBytes(128).toString('hex');
                keys.set(this, aesKey);
                resolve();
            });
        });
    }

    encode(address) {
        if (!keys.get(this)) return Promise.reject(new Error("Keys not initialised"));
        return new Promise((resolve, reject) => {
            let id = crypto.randomBytes(8).toString('hex');
            storage.get(this).get("addressV1Mappings").then((result) => {
                let res = result || {};
                res[id] = address;
                storage.get(this).set("addressV1Mappings", res);
                resolve(encodeAddress(mappingVersion + id, keys.get(this)));
            }).catch(reject);
        });
    }
    decode(data) {
        if (!keys.get(this)) return Promise.reject(new Error("Keys not initialised"));
        let payload = decodeAddress(data, keys.get(this));
        if (payload) {
            let version = payload.slice(0, 1);
            let addressMapping = payload.slice(1);
            if (this.decodeByVersion[version]) return this.decodeByVersion[version](addressMapping);
            else return Promise.resolve(null);
        } else return Promise.resolve(null);
    }
}

module.exports = VendorEncoder;
module.exports.META = META;
