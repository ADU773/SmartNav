const { randomUUID } = require("crypto");
const pino = require("pino");
const pinoHttp = require("pino-http");

function createLogger(env) {
    return pino({
        level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
        // Never let a token or password reach the log sink.
        redact: {
            paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.body.password",
                "req.body.refreshToken",
                "res.headers['set-cookie']",
            ],
            censor: "[redacted]",
        },
    });
}

function createHttpLogger(logger) {
    return pinoHttp({
        logger,
        // One id per request, echoed back so a user-reported error can be traced
        // to its exact log line.
        genReqId: (req, res) => {
            const existing = req.get("x-request-id");
            const id = existing || randomUUID();
            res.setHeader("x-request-id", id);
            return id;
        },
        customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return "error";
            if (res.statusCode >= 400) return "warn";
            return "info";
        },
        // Static assets would otherwise drown the useful lines.
        autoLogging: { ignore: (req) => req.url.startsWith("/uploads/") },
    });
}

module.exports = { createLogger, createHttpLogger };
