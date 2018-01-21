#!/usr/bin/env node

'use strict';

process.chdir(require("path").dirname(require.main.filename));

const PKGJSON = require("./package.json");
const NETWORKS = require("./networks.json");

const fs = require("fs");
const commander = require("commander");
const deepAssign = require("assign-deep");
const restify = require("restify");
const ConfigLoader = require("./modules/configLoader.js");
const UpdateChecker = require("./modules/updater.js");
const ArkBridge = require("./modules/arkBridge.js");
const ExtendableError = require("./modules/extendableError.js");
const VendorEncoder = require("./modules/vendorEncoder.js");

var confLoader;
var updater;
var updaterTimeout;
var StorageAdapter;
var storage;
var bridge;
var encoder;
var server;

var config = {};

class InvalidNetworkError extends ExtendableError {
    constructor(network) {
        super("Network `" + network + "` not found! Please check your config and the networks.json");
    }
}
class InvalidMnemonicPassphrase extends ExtendableError {
    constructor(passphrase) {
        super("The passphrase `" + passphrase + "` is invalid. Please check your config file.");
    }
}

const baseConfig = {
    updates: {
        checkOnStartup: true,
        checkRegularly: true,
        checkInterval: 24 * 60 * 60 * 1000
    },
    storage: {
        backend: "localStorage",
        dir: process.cwd() + "/storage/"
    },
    node: {
        fee: "0.1",
        network: "main",
        mnemonic: "",
        mnemonic2: "",
        updateInterval: 8 * 1000,
        randomDelay: true,
        maxDelay: 60 * 60 * 1000,
        payoutAddress: "",
        payoutThreshold: 3.1,
        payoutHoldback: 2,
        splitIntoMultipleTrx: false,
        vendorField: "Ark-Anonimizer Node",
    },
    rest: {
        port: 4005,
        keyFile: null,
        certFile: null
    }
};

function checkUpdate() {
    updater.checkUpdate().then(function (data) {
        if (data.newerVersion) {
            console.log([
                " ",
                " ",
                "+-------------------------------+",
                "|     New Version available     |",
                "|                               |",
                "|    Current Version: " + PKGJSON.version + "     |",
                "|     Latest Version: " + updater.getLatestVersion() + "     |",
                "+-------------------------------+",
                " ",
                " "
            ].join("\n"));
        }
    }).catch(() => {});
}

function initUpdater() {

    if (updaterTimeout) updaterTimeout = clearInterval(updaterTimeout);
    updater = new UpdateChecker("https://api.github.com/repos/Wolvan/ark-anon/releases/latest");

    if (config.updates.checkOnStartup) {
        checkUpdate();
    }
    if (config.updates.checkRegularly) {
        updaterTimeout = setInterval(checkUpdate, config.updates.checkInterval);
    }
}

function initCommander() {
    commander
        .option("-m, --mnemonic <Mnemonic Phrase>", "The mnemonic phrase for the ark wallet")
        .option("-n, --network <Network Name>", "The Network to connect to, see networks.json")
        .option("-f, --fee <Fee>", "The fee that must be paid to use this service", parseFloat)
        .option("-a, --address <Ark Address>", "Send Fee payout here")
        .option("--config <JSON Object>", "JSON Representation of a config override", JSON.parse)
        .parse(process.argv);
}

function initConfig() {
    let commanderData = {
        node: {}
    };
    if (commander.mnemonic) commanderData.node.mnemonic = commander.mnemonic;
    if (commander.fee) commanderData.node.fee = commander.fee;
    if (commander.network) commanderData.node.network = commander.network;
    if (commander.address) commanderData.node.payoutAddress = commander.address;
    let conf = deepAssign({}, baseConfig, (commander.config || {}), commanderData);
    confLoader = new ConfigLoader(conf);
    config = confLoader.getConfig();
    confLoader.saveConfig();
}

function initStorage() {
    StorageAdapter = require("./modules/storageAdapters/" + config.storage.backend + ".js");
    storage = new StorageAdapter(config.storage);
}

function initEncoder() {
    encoder = new VendorEncoder(storage);
    encoder.initKeys().then(() => {
        initBridge();
        initRESTServer();
    });
}

function initRESTServer() {
    let key = null;
    let cert = null;
    if (config.rest.keyFile && config.rest.certFile) {
        key = fs.readFileSync(config.rest.keyFile);
        cert = fs.readFileSync(config.rest.certFile);
    }
    server = restify.createServer({
        name: "ark-anon",
        version: PKGJSON.version,
        key: key,
        certificate: cert
    });
    server.pre(restify.plugins.pre.userAgentConnection());
    server.get("v1/encode/:address", (req, res, next) => {
        if (!req.params.address) res.send({
            success: false,
            error: "No address provided"
        });
        else if (!bridge.validateAddress(req.params.address)) res.send({
            success: false,
            error: "Invalid address format"
        });
        else encoder.encode(req.params.address).then((result) => {
            res.send({
                success: true,
                vendorField: result
            });
        });
        return next();
    });
    server.listen(config.rest.port, () => {
        console.log("[RESTSV]%s listening at %s", server.name, server.url);
    });
}

function initBridge() {
    if (!NETWORKS[config.node.network]) throw new InvalidNetworkError(config.node.network);
    if (!config.node.mnemonic) throw new InvalidMnemonicPassphrase(config.node.mnemonic);
    storage.get("transactions").then((result) => {
        bridge = new ArkBridge(storage, NETWORKS[config.node.network].seedNode, config.node.mnemonic, (result || []).map((item) => item.id), config.node.maxDelay, config.node.updateInterval);
        bridge.on("transactions", (transactions) => {
            storage.get("transactions").then((result) => {
                let store = result || [];
                transactions.forEach((item) => store.push(item));
                storage.set("transactions", store);
                let trxArray = [];
                let trxProc = 0;
                if (transactions.filter((item) => !!item.vendorField).length)
                    transactions.filter((item) => !!item.vendorField).forEach((item, _, arr) => {
                        encoder.decode(item.vendorField).then((result) => {
                            if (result) {
                                let fee = 0;
                                if (!config.node.fee.includes("%")) fee = parseFloat(config.node.fee) * Math.pow(10, 8);
                                else fee = (parseFloat(config.node.fee) / 100) * (item.amount - item.fee);
                                let trx = bridge.createTransaction(result, item.amount - fee, config.node.vendorField, config.node.mnemonic, config.node.mnemonic2);
                                trxArray.push(trx);
                            }
                            trxProc++;
                            if (trxProc === arr.length) {
                                if (trxArray.length) bridge.queueTransaction(trxArray).then(() => {
                                    console.log("[MAINPL]Processed " + transactions.length + " new transactions (" + arr.length + " vendorFields, " + trxArray.length + " valid vendorFields)");
                                }).catch(console.log);
                                else console.log("[MAINPL]Processed " + transactions.length + " new transactions (" + arr.length + " vendorFields, " + trxArray.length + " valid vendorFields)");
                            }
                        });
                    });
                else console.log("[MAINPL]Processed " + transactions.length + " new transactions (0 vendorFields)");
            });
        }).on("transactionsSent", (transactions, trxIds, balance) => {
            if (!trxIds.length) return;
            console.log("[MAINPL]Sent " + trxIds.length + " transactions.");
            if (config.node.payoutAddress) {
                if (balance > ((config.node.payoutThreshold + config.node.payoutHoldback) * Math.pow(10, 8))) {
                    console.log("[MAINPL]Payout Threshold reached. Paying out " + ((balance - (config.node.payoutHoldback * Math.pow(10, 8))) / Math.pow(10, 8)) + ".");
                    bridge.queueTransaction(bridge.createTransaction(config.node.payoutAddress, balance - (config.node.payoutHoldback * Math.pow(10, 8)), "Ark-Anonimizer Payout", config.node.mnemonic, config.node.mnemonic2));
                }
            }
        });
        bridge._startPolling();
    }).catch((error) => {
        throw error;
    });
}

function init() {
    initCommander();
    initConfig();
    initUpdater();
    initStorage();
    initEncoder(); // Encoder is the last step that can be done synchronously, handle further init in Encoder Init
}

init();
