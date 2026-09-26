const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const Project = require("../models/Project");
const Asset = require("../models/Asset");
const Scene = require("../models/Scene");
const PanoramaSession = require("../models/PanoramaSession");
const PendingFileDeletion = require("../models/PendingFileDeletion");
const { requireId, fail, sendError, withProject } = require("../services/integrity");
const { processPendingFiles } = require("../services/fileCleanup");
const { validateImage } = require("../middleware/uploadMiddleware");
const { deriveImageMetadata, removeDerivative } = require("../services/imagePipeline");

const SESSION_LIFETIME_MS = 60 * 60 * 1000;
// Guided capture targets ~12 frames; cap generously above that for retakes, well below the generic Asset limit.
const MAX_PANORAMA_PHOTOS = 300;
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
        if (!req.file) fail(400, "Select a photo to upload.");
        await validateImage(req.file);

        const metadata = parseFrameMetadata(req.body && req.body.metadata);

        // Fast path: a retry of a frame we already stored. No new Asset needed.
        if (metadata && session.photos.some((photo) => photo.frameId === metadata.frameId)) {
            return res.status(200).json({ success: true, data: { photos: session.photos } });
        }

        // After the retry check, so a re-sent frame never pays for a resize.
        derived = await deriveImageMetadata(req.file.path, req.file.filename);
        asset = await Asset.create({
            projectId: session.projectId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: `/uploads/${req.file.filename}`,
            ...derived,
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
                    if (cleanupError.code !== "ENOENT") req.log?.error({ err: cleanupError }, "Failed to remove duplicate capture");
                });
                await removeDerivative(uploadDirectory, derived?.thumbnailFilename).catch((cleanupError) => {
                    req.log?.error({ err: cleanupError }, "Failed to remove duplicate capture thumbnail");
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
            catch (cleanupError) { if (cleanupError.code !== "ENOENT") req.log?.error({ err: cleanupError }, "Failed to remove rejected capture"); }
            try { await removeDerivative(uploadDirectory, derived?.thumbnailFilename); }
            catch (cleanupError) { req.log?.error({ err: cleanupError }, "Failed to remove orphaned capture thumbnail"); }
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

/** Every form a stored reference to an upload can take (relative, bare, absolute URL). */
function referencesTo(assetPath) {
    const escaped = assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [assetPath, assetPath.replace(/^\//, ""), new RegExp(`^https?://[^/]+${escaped}(?:[?#].*)?$`, "i")];
}

/**
 * Called once a stitch has been uploaded as an asset: records the panorama on
 * the session and deletes the source photos, which are now redundant.
 *
 * Safety rules, in order:
 *  - Owner only. A phone holding the session token can add photos, but only
 *    the project owner can delete them.
 *  - The session is closed first, atomically, so a photo still in flight from
 *    the phone cannot land after the delete list is built and be orphaned.
 *  - Deletion runs in the project transaction, and the panorama is recorded
 *    with a conditional write inside it. A second finalize therefore fails
 *    with 409 and rolls its own deletions back.
 *  - A source photo already used as a scene image or floor plan is kept and
 *    reported, never silently removed from under that scene.
 */
const finalizeSession = async (req, res) => {
    try {
        const { token } = req.params;
        if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) fail(400, "A valid session token is required.");
        const panoramaAssetId = String((req.body || {}).panoramaAssetId || "");
        requireId(panoramaAssetId, "panorama asset ID");

        // No expiry filter: a long stitch may legitimately finish just after the hour.
        const existing = await PanoramaSession.findOne({ token }).select("projectId panorama").lean();
        if (!existing) fail(404, "This capture session was not found or has expired.");
        if (existing.panorama?.assetId) fail(409, "This capture session has already been finalized.");

        const closed = await PanoramaSession.findOneAndUpdate(
            { token }, { $set: { status: "done" } }, { returnDocument: "after" },
        );
        if (!closed) fail(404, "This capture session was not found or has expired.");

        const result = await withProject(closed.projectId, async (project, session) => {
            const panorama = await Asset.findOne({ _id: panoramaAssetId, projectId: project._id }).session(session);
            if (!panorama) fail(400, "The panorama must be an asset in this session's project.");

            const sourceIds = closed.photos.map((photo) => String(photo.assetId)).filter((id) => id !== String(panorama._id));
            const sources = await Asset.find({ _id: { $in: sourceIds }, projectId: project._id }).session(session);

            const doomed = [];
            const kept = [];
            for (const asset of sources) {
                const references = referencesTo(asset.path);
                const usedByScene = await Scene.exists({ projectId: project._id, image: { $in: references } }).session(session);
                const usedAsFloorPlan = references.some((ref) => (ref instanceof RegExp ? ref.test(project.floorPlan || "") : ref === project.floorPlan));
                if (usedByScene || usedAsFloorPlan) {
                    kept.push({ assetId: String(asset._id), reason: usedByScene ? "used by a scene" : "used as the floor plan" });
                } else {
                    doomed.push(asset);
                }
            }

            if (doomed.length) {
                await PendingFileDeletion.insertMany(doomed.flatMap((asset) => [
                    { filename: asset.filename },
                    ...(asset.thumbnailFilename ? [{ filename: asset.thumbnailFilename }] : []),
                ]), { session });
                await Asset.deleteMany({ _id: { $in: doomed.map((asset) => asset._id) } }, { session });
            }

            const recorded = await PanoramaSession.updateOne(
                { token, "panorama.assetId": { $exists: false } },
                {
                    $set: { panorama: { assetId: panorama._id, path: panorama.path, sourceCount: sourceIds.length } },
                    $pull: { photos: { assetId: { $in: doomed.map((asset) => asset._id) } } },
                },
                { session },
            );
            if (recorded.matchedCount !== 1) fail(409, "This capture session has already been finalized.");

            return {
                panorama: { assetId: String(panorama._id), path: panorama.path },
                deleted: doomed.length,
                kept,
            };
        }, { ownerId: req.user.id });

        // Files go only after the commit; failures stay queued for retry.
        let cleanupPending = false;
        try { await processPendingFiles(); cleanupPending = !!await PendingFileDeletion.exists({}); }
        catch (error) { cleanupPending = true; req.log?.error({ err: error }, "Capture cleanup deferred"); }

        res.json({ success: true, data: { ...result, ...(cleanupPending ? { cleanupPending: true } : {}) } });
    } catch (error) { sendError(res, error); }
};

module.exports = { createSession, getSession, streamSession, uploadPhoto, completeSession, finalizeSession, MAX_PANORAMA_PHOTOS };
