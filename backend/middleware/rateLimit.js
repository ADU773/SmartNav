const rateLimit = require("express-rate-limit");

const isTest = () => process.env.NODE_ENV === "test";

function limiter({ windowMs, max, message }) {
    return rateLimit({
        windowMs,
        limit: max,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        // Tests assert behavior, not throughput; a limiter would make them flaky.
        skip: isTest,
        handler: (_req, res) => res.status(429).json({ success: false, message }),
    });
}

// Broad backstop for the whole API surface.
const apiLimiter = limiter({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: "Too many requests. Wait a moment and try again.",
});

// Credential endpoints: tight enough to make online password guessing useless.
const authLimiter = limiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: "Too many sign-in attempts. Try again in a few minutes.",
});

// Uploads accept files up to 500 MB, so an unthrottled route is a disk-fill.
const uploadLimiter = limiter({
    windowMs: 60 * 60 * 1000,
    max: 120,
    message: "Upload limit reached. Try again later.",
});

// Panorama sessions are created from a single click; nobody needs many per hour.
const sessionLimiter = limiter({
    windowMs: 60 * 60 * 1000,
    max: 60,
    message: "Too many capture sessions started. Try again later.",
});

module.exports = { apiLimiter, authLimiter, uploadLimiter, sessionLimiter };
