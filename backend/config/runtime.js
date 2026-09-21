const { loadEnv } = require("./env");

// Single validated environment for the process. server.js calls init() at boot;
// tests call it with their own values before requiring anything that reads it.
let current = null;

function init(source = process.env) {
    current = loadEnv(source);
    return current;
}

function env() {
    if (!current) current = loadEnv(process.env);
    return current;
}

module.exports = { init, env };
