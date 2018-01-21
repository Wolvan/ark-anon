'use strict';

const META = {
    author: "Wolvan",
    name: "ArkBridge",
    description: "Fetch new transactions and emit events",
    version: "1.0.0"
};

const EventEmitter2 = require("eventemitter2");
const request = require("request");
const arkjs = require("arkjs");

const ExtendableError = require("./extendableError.js");

const api = new WeakMap();
const peers = new WeakMap();
const nethash = new WeakMap();
const version = new WeakMap();
const fee = new WeakMap();
const storage = new WeakMap();
const pollingTime = new WeakMap();
const interval = new WeakMap();
const passphrases = new WeakMap();
const addresses = new WeakMap();
const oldTransactions = new WeakMap();
const pollCount = new WeakMap();
const switchCount = new WeakMap();
const delay = new WeakMap();
const timeouts = new WeakMap();

class HTTPRequestInvalidStatusCode extends ExtendableError {
    constructor(code) {
        super("HTTP Request completed with Status Code " + code);
    }
}

class ArkBridge extends EventEmitter2.EventEmitter2 {
    constructor(store, apiEndpoint, passphrase, transactions = [], randomTimeout = 60 * 60 * 1000, pollInterval = 8 * 1000) {
        super();
        api.set(this, apiEndpoint);
        pollingTime.set(this, pollInterval);
        passphrases.set(this, passphrase);
        oldTransactions.set(this, transactions);
        storage.set(this, store);
        delay.set(this, randomTimeout);
        pollCount.set(this, 0);

        storage.get(this).get("trxQ").then((result) => {
            let res = result || [];
            if (res.length && !timeouts.get(this)) timeouts.set(this, setTimeout(() => {
                storage.get(this).get("trxQ").then((result) => {
                    if (result && result.length) this.sendTransaction(result);
                    storage.get(this).set("trxQ", []);
                    timeouts.set(this, null);
                });
            }, Math.floor(Math.random() * delay.get(this))));
        });

        request({
            url: apiEndpoint + "/api/loader/autoconfigure",
            headers: {
                'User-Agent': `${META.author}/${META.name} ${META.version}`
            }
        }, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                var data = JSON.parse(body);
                if (data.success) {
                    nethash.set(this, data.network.nethash);
                    addresses.set(this, arkjs.crypto.getAddress(arkjs.crypto.getKeys(passphrase).publicKey, data.network.version));
                    arkjs.crypto.setNetworkVersion(data.network.version);
                    request({
                        url: apiEndpoint + "/api/blocks/getFee",
                        headers: {
                            'User-Agent': `${META.author}/${META.name} ${META.version}`
                        }
                    }, (error, response, body) => {
                        if (!error && response.statusCode === 200) {
                            var data = JSON.parse(body);
                            if (data.success) {
                                fee.set(this, data.fee);
                                request({
                                    url: apiEndpoint + "/api/peers",
                                    headers: {
                                        'User-Agent': `${META.author}/${META.name} ${META.version}`
                                    }
                                }, (error, response, body) => {
                                    if (!error && response.statusCode === 200) {
                                        var data = JSON.parse(body);
                                        if (data.success) {
                                            peers.set(this, data.peers);
                                            this.switchToRandomPeer();
                                        }
                                    } else {
                                        if (error) throw error;
                                        throw new HTTPRequestInvalidStatusCode(response.statusCode);
                                    }
                                });

                            }
                        } else {
                            if (error) throw error;
                            throw new HTTPRequestInvalidStatusCode(response.statusCode);
                        }
                    });
                } else {
                    if (error) throw error;
                    throw new HTTPRequestInvalidStatusCode(response.statusCode);
                }
            }
        });

    }
    switchToRandomPeer() {
        let testPeer = function (peerList) {
            let peer = peerList.splice(Math.floor(Math.random() * peerList.length), 1)[0];
            console.log("[ARKBG]Testing peer " + peer.ip + ":" + peer.port);
            request({
                url: "http://" + peer.ip + ":" + peer.port + "/api/blocks/getNetHash",
                headers: {
                    'User-Agent': `${META.author}/${META.name} ${META.version}`
                }
            }, (error, response, body) => {
                if (!error && response.statusCode === 200) {
                    try {
                        var data = JSON.parse(body);
                        if (data.success && data.nethash === nethash.get(this)) {
                            console.log("[ARKBG]Suitable peer found. New peer: " + peer.ip + ":" + peer.port);
                            api.set(this, "http://" + peer.ip + ":" + peer.port);
                            this.emit("peerSwitch", peer.ip + ":" + peer.port);
                            switchCount.set(this, switchCount.get(this) + 1);
                        } else {
                            testPeer(peerList);
                        }
                    } catch (error) {
                        testPeer(peerList);
                    }
                } else {
                    testPeer(peerList);
                }
            });
        }.bind(this);
        console.log("[ARKBG]Switching peers...");
        if (switchCount.get(this) > 5) {
            console.log("[ARKBG]Refreshing peers...");
            request({
                url: api.get(this) + "/api/peers",
                headers: {
                    'User-Agent': `${META.author}/${META.name} ${META.version}`
                }
            }, (error, response, body) => {
                if (!error && response.statusCode === 200) {
                    var data = JSON.parse(body);
                    if (data.success) {
                        peers.set(this, data.peers);
                        switchCount.set(this, 0);
                        this.switchToRandomPeer();
                    }
                } else {
                    if (error) throw error;
                    throw new HTTPRequestInvalidStatusCode(response.statusCode);
                }
            });
        } else testPeer(Array.from(peers.get(this)));
    }
    _startPolling() {
        interval.set(this, setInterval(() => {
            request({
                url: api.get(this) + "/api/transactions?recipientId=" + addresses.get(this),
                headers: {
                    'User-Agent': `${META.author}/${META.name} ${META.version}`
                }
            }, (error, response, body) => {
                pollCount.set(this, pollCount.get(this) + 1);
                if (pollCount.get(this) > 9) {
                    pollCount.set(this, 0);
                    this.switchToRandomPeer();
                }
                if (!error && response.statusCode === 200) {
                    try {
                        var data = JSON.parse(body);
                        if (data.success) {
                            let newTransactions = data.transactions.filter((item) => !oldTransactions.get(this).includes(item.id));
                            newTransactions.forEach((item) => oldTransactions.get(this).push(item.id));
                            if (newTransactions.length) this.emit("transactions", newTransactions);
                        }
                    } catch (error) {}
                }
            });
        }, pollingTime.get(this)));
    }
    _stopPolling() {
        if (interval.get(this)) clearInterval(interval.get(this));
        interval.delete(this);
    }
    createTransaction(recipientId, amount, vendorField, mnemonic, mnemonic2) {
        return arkjs.transaction.createTransaction(recipientId, amount - fee.get(this), vendorField, mnemonic, (mnemonic2 ? mnemonic2 : undefined));
    }
    queueTransaction(trx) {
        storage.get(this).get("trxQ").then((result) => {
            let res = result || [];
            res = res.concat(trx);
            storage.get(this).set("trxQ", res);
            if (res.length && !timeouts.get(this)) timeouts.set(this, setTimeout(() => {
                storage.get(this).get("trxQ").then((result) => {
                    if (result && result.length) this.sendTransaction(result);
                    storage.get(this).set("trxQ", []);
                    timeouts.set(this, null);
                });
            }, Math.floor(Math.random() * delay.get(this))));
        });
        return Promise.resolve();
    }
    sendTransaction(trx) {
        return new Promise((resolve, reject) => {
            request({
                url: api.get(this) + "/peer/transactions",
                json: {
                    transactions: (Array.isArray(trx) ? trx : [trx])
                },
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "os": require("os").type() + "-" + require("os").release(),
                    "version": require("../package.json").version,
                    "port": 1,
                    "nethash": nethash.get(this)
                }
            }, (err, response, body) => {
                if (err || response.statusCode !== 200) reject(err || new HTTPRequestInvalidStatusCode(response.statusCode));
                else {
                    resolve(body);
                    this.getSelfBalance().then((result) => {
                        let pendingBalance = 0;
                        trx.forEach((item) => pendingBalance += item.amount + item.fee);
                        this.emit("transactionsSent", trx, body.transactionIds, (result - pendingBalance));
                    });
                }
            });
        });
    }
    getSelfBalance() {
        return new Promise((resolve, reject) => {
            request({
                url: api.get(this) + "/api/accounts?address=" + addresses.get(this),
                headers: {
                    'User-Agent': `${META.author}/${META.name} ${META.version}`
                }
            }, (error, response, body) => {
                if (!error && response.statusCode === 200) {
                    var data = JSON.parse(body);
                    if (data.success) {
                        resolve(data.account.balance);
                    }
                } else {
                    if (error) reject(error);
                    reject(new HTTPRequestInvalidStatusCode(response.statusCode));
                }
            });
        });
    }
    validateAddress(address) {
        return arkjs.crypto.validateAddress(address, version.get(this));
    }
}

module.exports = ArkBridge;
module.exports.HTTPRequestInvalidStatusCode = HTTPRequestInvalidStatusCode;
module.exports.META = META;
