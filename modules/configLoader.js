"use strict";

const META = {
    author: "Wolvan",
    name: "Config",
    description: "Load and/or reload configuration file from disk.",
    version: "1.0.0"
};

const reload = require("require-reload");
const deepAssign = require("assign-deep");
const fs = require("fs");

const settings = new WeakMap();
const config = new WeakMap();

class ConfigLoader {
    constructor(baseConfig = {}, files = ["config.json", "config.js"], loadEnv = true) {
        settings.set(this, {
            files: files,
            env: loadEnv
        });
        config.set(this, baseConfig);
        this._loadConfig(loadEnv);
    }
    _loadFiles() {
        var loadedConfig = null;
        let configFiles = settings.get(this).files;
        configFiles.forEach((item) => {
            try {
                let tmp = reload("../" + item);
                if (tmp) loadedConfig = deepAssign((loadedConfig || {}), tmp);
            } catch (error) {}
        });
        if (loadedConfig) config.set(this, deepAssign(config.get(this), loadedConfig));
        return this;
    }
    _loadEnv() {
        const ENVJSON = process.env.ARKANON_CONFIG;
        const ENVCONFIG = Object.keys(process.env).filter((item) => item.startsWith("ARKANON_CONFIG_"));
        if (ENVJSON) try {
            let parsed = JSON.parse(ENVJSON);
            if (parsed) config.set(this, deepAssign(config.get(this), parsed));
        } catch (error) {}

        ENVCONFIG.forEach((item) => {
            let configPath = item.replace("ARKANON_CONFIG_", "").split("_");
            let temp = config.get(this);
            let part = "";
            for (let i = 0; i < configPath.length; i++) {
                part += configPath[i];
                if (temp[part]) {
                    temp = temp[part];
                    part = "";
                } else {
                    if (i < (configPath.length - 1)) part += "_";
                }
                if (i === (configPath.length - 1)) temp[part] = process.env[item];
            }
        });
        return this;
    }
    _getConfig() {
        return config.get(this);
    }
    getConfig() {
        return deepAssign({}, this._getConfig());
    }
    _loadConfig(loadEnv = false) {
        this._loadFiles();
        if (loadEnv) this._loadEnv();
        return this;
    }
    reload() {
        return this._loadConfig(settings.get(this).env);
    }
    saveConfig() {
        let configFile = settings.get(this).files.filter((item) => item.match(/\.json$/gi))[0];
        if (configFile) fs.writeFileSync("./" + configFile, JSON.stringify(this._getConfig(), null, "\t"));
    }
}

module.exports = ConfigLoader;
module.exports.META = META;
