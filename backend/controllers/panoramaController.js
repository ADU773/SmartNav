const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const Project = require("../models/Project");
const Asset = require("../models/Asset");
const PanoramaSession = require("../models/PanoramaSession");
const { requireId, fail, sendError } = require("../services/integrity");
const { validateImage } = require("../middleware/uploadMiddleware");
const { deriveImageMetadata, removeDerivative } = require("../services/imagePipeline");

const SESSION_LIFETIME_MS = 60 * 60 * 1000;
const MAX_PHOTOS_PER_SESSION = 60;
const SSE_HEARTBEAT_MS = 25000;

const uploadDirectory = path.join(__dirname, "..", "uploads");

async function findOpenSession(token) {
    // The token is the session's only credential, so shape-check it before it
    // reaches the database.
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) fail(400, "A valid session token is required.");
    const session = await PanoramaSession.findOne({ token, expiresAt: { $gt: new Date() } });
    if (!session) fail(404, "This capture session was not found or has expired.");
    return session;
}

const createSession = async (req, res) => {
    try {
        const { projectId } = req.body || {};
        requireId(String(projectId || ""), "project ID");
        // Only the project's owner may open a capture session against it.
        if (!await Project.exists({ _id: projectId, ownerId: req.user.id })) fail(404, "Project not found.");
        const session = await PanoramaSession.create({
            projectId,
            token: randomUUID(),
            expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
        });
        res.status(201).json({ success: true, data: { token: session.token, status: session.status, expiresAt: session.expiresAt } });
    } catch (error) { sendError(res, error); }
};

const getSession = async (req, res) => {
    try {
        const session = await findOpenSession(req.params.token);
        res.json({ success: true, data: { status: session.status, photos: session.photos, expiresAt: session.expiresAt } });
    } catch (error) { sendError(res, error); }
};

/**
 * Server-sent events for one capture session, replacing the desktop page's
 * 2.5s poll. The phone writes through the ordinary upload endpoint, so this
 * still reads the session rather than receiving a push; the difference is one
 * held connection per viewer instead of a request every 2.5 seconds, and
 * updates land as soon as they are written.
 */
const streamSession = async (req, res) => {
    let session;
    try {
        session = await findOpenSession(req.params.token);
    } catch (error) {
        return sendError(res, error);
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });

    let lastSerialized = "";
    const send = (data) => {
        const serialized = JSON.stringify(data);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        res.write(`data: ${serialized}\n\n`);
    };

    send({ status: session.status, photos: session.photos, expiresAt: session.expiresAt });

    const poll = setInterval(async () => {
        try {
            const current = await PanoramaSession.findOne({ token: req.params.token }).lean();
            if (!current || current.expiresAt <= new Date()) {
                res.write(`event: expired\ndata: {}\n\n`);
                return close();
            }
            send({ status: current.status, photos: current.photos, expiresAt: current.expiresAt });
        } catch (error) {
            req.log?.error({ err: error }, "Panorama stream poll failed");
        }
    }, 1500);

    // Proxies drop idle connections; a comment frame keeps this one alive.
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), SSE_HEARTBEAT_MS);

    const close = () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        res.end();
    };
    req.on("close", close);
};

const uploadPhoto = async (req, res) => {
    let asset;
    let derived = null;
    try {
        const session = await findOpenSession(req.params.token);
        if (session.status !== "open") fail(400, "This capture session is no longer accepting photos.");
        if (session.photos.length >= MAX_PHOTOS_PER_SESSION) fail(400, `A capture session holds at most ${MAX_PHOTOS_PER_SESSION} photos.`);
        if (!req.file) fail(400, "Select a photo to upload.");
        await validateImage(req.file);
        derived = await deriveImageMetadata(req.file.path, req.file.filename);
        asset = await Asset.create({
            projectId: session.projectId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: `/uploads/${req.file.filename}`,
            ...derived,
        });
        session.photos.push({ assetId: asset._id, path: asset.path });
        await session.save();
        res.status(200).json({ success: true, data: { photos: session.photos } });
    } catch (error) {
        sendError(res, error);
    } finally {
        if (req.file && !asset) {
            try { await fs.unlink(req.file.path); }
            catch (cleanupError) { if (cleanupError.code !== "ENOENT") req.log?.error({ err: cleanupError }, "Failed to remove rejected capture"); }
            try { await removeDerivative(uploadDirectory, derived?.thumbnailFilename); }
            catch (cleanupError) { req.log?.error({ err: cleanupError }, "Failed to remove orphaned capture thumbnail"); }
        }
    }
};

const completeSession = async (req, res) => {
    try {
        const session = await findOpenSession(req.params.token);
        session.status = "done";
        await session.save();
        res.json({ success: true, data: { status: session.status, photos: session.photos } });
    } catch (error) { sendError(res, error); }
};

module.exports = { createSession, getSession, streamSession, uploadPhoto, completeSession, MAX_PHOTOS_PER_SESSION };
