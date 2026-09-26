require("dotenv").config();

const mongoose = require("mongoose");
const runtime = require("./config/runtime");
const { createLogger } = require("./config/logger");
const connectDB = require("./config/db");
const { createApp } = require("./app");
const { processPendingFiles } = require("./services/fileCleanup");

// Validate the environment before anything else touches it, so a missing
// secret or connection string fails here with a readable message.
let env;
try {
    env = runtime.init();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

const logger = createLogger(env);
const app = createApp(env, logger);

let cleaningFiles = false;
const retryFileCleanup = async () => {
    if (cleaningFiles || mongoose.connection.readyState !== 1) return;
    cleaningFiles = true;
    try { await processPendingFiles(); }
    catch (error) { logger.error({ err: error }, "Upload cleanup deferred"); }
    finally { cleaningFiles = false; }
};

connectDB().then(retryFileCleanup).catch((error) => {
    logger.error({ err: error }, "Initial database connection failed");
});
setInterval(retryFileCleanup, 60000).unref();

const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "SmartNav360 backend listening");
});

// Finish in-flight requests before exiting so a deploy does not drop uploads.
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        logger.info({ signal }, "Shutting down");
        server.close(() => {
            mongoose.connection.close(false).finally(() => process.exit(0));
        });
        setTimeout(() => process.exit(1), 10000).unref();
    });
}

module.exports = { app, server };
