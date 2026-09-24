const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const Project = require("../models/Project");
const Asset = require("../models/Asset");
const PanoramaSession = require("../models/PanoramaSession");
const { requireId, fail, sendError } = require("../services/integrity");
const { validateImage } = require("../middleware/uploadMiddleware");

const SESSION_LIFETIME_MS = 60 * 60 * 1000;
// Guided capture targets ~12 frames; cap generously above that for retakes, well below the generic Asset limit.
const MAX_PANORAMA_PHOTOS = 300;

async function findOpenSession(token) {
    if (typeof token !== "string" || !token) fail(400, "A valid session token is required.");
    const session = await PanoramaSession.findOne({ token, expiresAt: { $gt: new Date() } });
    if (!session) fail(404, "This capture session was not found or has expired.");
    return session;
}

// Validates the optional multipart "metadata" field sent by the native capture app.
// Browser uploads omit it entirely (returns null).
function parseFrameMetadata(raw) {
    if (raw === undefined || raw === null || raw === "") return null;
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        fail(400, "metadata must be valid JSON.");
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) fail(400, "metadata must be a JSON object.");

    const { frameId, sequence, yaw, pitch, roll } = data;
    if (typeof frameId !== "string" || !frameId.trim() || frameId.length > 128) {
        fail(400, "metadata.frameId must be a non-empty string.");
    }
    if (sequence !== undefined && (!Number.isInteger(sequence) || sequence < 0)) {
        fail(400, "metadata.sequence must be a non-negative integer.");
    }
    const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
    for (const [key, value] of [["yaw", yaw], ["pitch", pitch], ["roll", roll]]) {
        if (value !== undefined && !isFiniteNumber(value)) fail(400, `metadata.${key} must be a finite number.`);
    }

    const parsed = { frameId: frameId.trim() };
    if (sequence !== undefined) parsed.sequence = sequence;
    if (yaw !== undefined) parsed.yaw = yaw;
    if (pitch !== undefined) parsed.pitch = pitch;
    if (roll !== undefined) parsed.roll = roll;
    return parsed;
}

const createSession = async (req, res) => {
    try {
        const { projectId } = req.body || {};
        requireId(String(projectId || ""), "project ID");
        if (!await Project.exists({ _id: projectId })) fail(404, "Project not found.");
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

const uploadPhoto = async (req, res) => {
    let asset;
    try {
        const session = await findOpenSession(req.params.token);
        if (session.status !== "open") fail(400, "This capture session is no longer accepting photos.");
        if (!req.file) fail(400, "Select a photo to upload.");
        await validateImage(req.file);

        const metadata = parseFrameMetadata(req.body && req.body.metadata);

        // Fast path: a retry of a frame we already stored. No new Asset needed.
        if (metadata && session.photos.some((photo) => photo.frameId === metadata.frameId)) {
            return res.status(200).json({ success: true, data: { photos: session.photos } });
        }

        asset = await Asset.create({
            projectId: session.projectId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: `/uploads/${req.file.filename}`,
        });

        const photoEntry = { assetId: asset._id, path: asset.path };
        if (metadata) Object.assign(photoEntry, metadata);

        // Atomic conditional push: avoids a check-then-insert race on concurrent
        // retries of the same frameId, and enforces the photo cap without a
        // separate count query.
        const filter = {
            token: req.params.token,
            status: "open",
            expiresAt: { $gt: new Date() },
            $expr: { $lt: [{ $size: "$photos" }, MAX_PANORAMA_PHOTOS] },
        };
        if (metadata) filter["photos.frameId"] = { $ne: metadata.frameId };

        const updated = await PanoramaSession.findOneAndUpdate(
            filter,
            { $push: { photos: photoEntry } },
            { returnDocument: "after" },
        );

        if (!updated) {
            const current = await PanoramaSession.findOne({ token: req.params.token });
            if (!current || current.expiresAt <= new Date()) fail(404, "This capture session was not found or has expired.");
            if (current.status !== "open") fail(400, "This capture session is no longer accepting photos.");
            if (metadata && current.photos.some((photo) => photo.frameId === metadata.frameId)) {
                // Lost the race to a concurrent retry of the same frame; discard our orphan.
                await Asset.deleteOne({ _id: asset._id });
                await fs.unlink(req.file.path).catch((cleanupError) => {
                    if (cleanupError.code !== "ENOENT") console.error("Failed to remove duplicate capture:", cleanupError);
                });
                return res.status(200).json({ success: true, data: { photos: current.photos } });
            }
            fail(400, "This capture session has reached its photo limit.");
        }

        res.status(200).json({ success: true, data: { photos: updated.photos } });
    } catch (error) {
        sendError(res, error);
    } finally {
        if (req.file && !asset) {
            try { await fs.unlink(req.file.path); }
            catch (cleanupError) { if (cleanupError.code !== "ENOENT") console.error("Failed to remove rejected capture:", cleanupError); }
        }
    }
};

const completeSession = async (req, res) => {
    try {
        // Atomic status flip: saving a document read moments earlier would
        // rewrite the whole photos array and could drop a photo that arrived
        // in between. Completion is idempotent, so a repeat call still succeeds.
        const session = await PanoramaSession.findOneAndUpdate(
            { token: req.params.token, expiresAt: { $gt: new Date() } },
            { $set: { status: "done" } },
            { returnDocument: "after" },
        );
        if (!session) fail(404, "This capture session was not found or has expired.");
        res.json({ success: true, data: { status: session.status, photos: session.photos } });
    } catch (error) { sendError(res, error); }
};

module.exports = { createSession, getSession, uploadPhoto, completeSession };
