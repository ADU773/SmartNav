const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const Project = require("../models/Project");
const Asset = require("../models/Asset");
const PanoramaSession = require("../models/PanoramaSession");
const { requireId, fail, sendError } = require("../services/integrity");
const { validateImage } = require("../middleware/uploadMiddleware");

const SESSION_LIFETIME_MS = 60 * 60 * 1000;

async function findOpenSession(token) {
    if (typeof token !== "string" || !token) fail(400, "A valid session token is required.");
    const session = await PanoramaSession.findOne({ token, expiresAt: { $gt: new Date() } });
    if (!session) fail(404, "This capture session was not found or has expired.");
    return session;
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
        asset = await Asset.create({
            projectId: session.projectId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: `/uploads/${req.file.filename}`,
        });
        session.photos.push({ assetId: asset._id, path: asset.path });
        await session.save();
        res.status(200).json({ success: true, data: { photos: session.photos } });
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
        const session = await findOpenSession(req.params.token);
        session.status = "done";
        await session.save();
        res.json({ success: true, data: { status: session.status, photos: session.photos } });
    } catch (error) { sendError(res, error); }
};

module.exports = { createSession, getSession, uploadPhoto, completeSession };
