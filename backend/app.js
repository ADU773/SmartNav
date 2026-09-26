const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const mongoose = require("mongoose");
const multer = require("multer");

const { createHttpLogger } = require("./config/logger");
const { apiLimiter } = require("./middleware/rateLimit");

const authRoutes = require("./routes/authRoutes");
const projectRoutes = require("./routes/projectRoutes");
const sceneRoutes = require("./routes/sceneRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const featureRoutes = require("./routes/featureRoutes");
const visionRoutes = require("./routes/visionRoutes");
const panoramaRoutes = require("./routes/panoramaRoutes");
const locateRoutes = require("./routes/locateRoutes");

/**
 * Builds the Express application. Separated from server.js so tests can mount
 * the real routing stack without binding a port or opening a DB connection.
 *
 * @param {object} env - validated environment from config/env.js
 * @param {import('pino').Logger} [logger]
 */
function createApp(env, logger) {
    const app = express();

    // Behind a proxy the client IP arrives in X-Forwarded-For; without this the
    // rate limiters would bucket every request under the proxy's own address.
    app.set("trust proxy", 1);

    if (logger) app.use(createHttpLogger(logger));

    app.use(helmet({
        // Uploaded images are served from this origin and embedded by the
        // frontend on another port, so the default same-origin policy would
        // block every panorama.
        crossOriginResourcePolicy: { policy: "cross-origin" },
        // The API serves JSON and static images, never HTML that needs a CSP.
        contentSecurityPolicy: false,
    }));

    const allowed = new Set(env.corsOrigins);
    app.use(cors({
        origin(origin, callback) {
            // No Origin header means a same-origin or non-browser client
            // (curl, the health checker, a mobile webview) — not a CORS request.
            if (!origin || allowed.has(origin)) return callback(null, true);
            return callback(new Error("This origin is not allowed to call the SmartNav360 API."));
        },
        credentials: true,
    }));

    app.use(express.json({ limit: "1mb" }));

    // Liveness/readiness for orchestration: reports the DB state rather than
    // claiming health the moment the process is up.
    app.get("/healthz", (_req, res) => {
        const states = ["disconnected", "connected", "connecting", "disconnecting"];
        const ready = mongoose.connection.readyState === 1;
        res.status(ready ? 200 : 503).json({
            success: ready,
            status: ready ? "ok" : "degraded",
            database: states[mongoose.connection.readyState] || "unknown",
            uptimeSeconds: Math.round(process.uptime()),
        });
    });

    app.use("/api", apiLimiter);
    app.use("/api", (req, res, next) => {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: "The database is reconnecting. Check MongoDB Atlas Network Access, then try again in a moment."
            });
        }
        next();
    });

    app.use("/api/auth", authRoutes);
    app.use("/api/projects", projectRoutes);
    app.use("/api/scenes", sceneRoutes);
    app.use("/api/upload", uploadRoutes);
    app.use("/api", featureRoutes);
    app.use("/api/vision", visionRoutes);
    app.use("/api/panorama", panoramaRoutes);
    app.use("/api/locate", locateRoutes);

    app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
        // Uploaded filenames are random UUIDs, so a given URL always names the
        // same bytes and can be cached hard.
        maxAge: "30d",
        immutable: true,
        setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }));

    app.get("/", (_req, res) => {
        res.send("SmartNav360 Backend Running");
    });

    app.use((error, req, res, next) => {
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: error.code === "LIMIT_FILE_SIZE" ? "Image must be 500 MB or smaller." : error.message });
        }
        if (error) {
            req.log?.error({ err: error }, "Unhandled request error");
            return res.status(error.status || 400).json({ success: false, message: error.message || "Request failed." });
        }
        return next();
    });

    return app;
}

module.exports = { createApp };
