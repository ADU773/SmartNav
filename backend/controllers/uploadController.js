const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const Asset = require("../models/Asset");
const PendingFileDeletion = require("../models/PendingFileDeletion");
const { withProject, readableProject, requireId, pagination, pageMeta, fail, sendError } = require("../services/integrity");
const { validateImage } = require("../middleware/uploadMiddleware");
const { processPendingFiles } = require("../services/fileCleanup");
const { deriveImageMetadata, removeDerivative } = require("../services/imagePipeline");

const uploadDirectory = path.join(__dirname, "..", "uploads");

const uploadImage = async (req, res) => {
    let asset;
    let uncertainCommit = false;
    let derived = null;
    try {
        const { projectId } = req.body || {};
        if (typeof projectId !== "string" || !mongoose.isObjectIdOrHexString(projectId)) {
            return res.status(400).json({ success: false, message: "A valid project ID is required." });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Select an image file to upload." });
        }
        await validateImage(req.file);
        // Derive dimensions and a thumbnail before the transaction so a slow
        // resize never holds the project lock.
        derived = await deriveImageMetadata(req.file.path, req.file.filename);

        asset = await withProject(projectId, async (_project, session) => {
            const [created] = await Asset.create([{
                projectId,
                filename: req.file.filename,
                originalName: req.file.originalname,
                path: `/uploads/${req.file.filename}`,
                ...derived,
            }], { session });
            return created;
        }, { ownerId: req.user.id });
        return res.status(200).json({ success: true, data: asset });
    } catch (error) {
        // A lost commit acknowledgement may still mean the asset was saved.
        uncertainCommit = !!error.hasErrorLabel?.("UnknownTransactionCommitResult");
        return sendError(res, error);
    } finally {
        // Multer cleans up its own parsing errors. Once it hands off to this
        // controller, remove the file unless its asset record was saved.
        if (req.file && !asset && !uncertainCommit) {
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                if (cleanupError.code !== "ENOENT") req.log?.error({ err: cleanupError }, "Failed to remove rejected upload");
            }
            // The derivative is worthless without its asset row.
            try {
                await removeDerivative(uploadDirectory, derived?.thumbnailFilename);
            } catch (cleanupError) {
                req.log?.error({ err: cleanupError }, "Failed to remove orphaned thumbnail");
            }
        }
    }
};

const getUploads = async (req, res) => {
    try {
        const { projectId } = req.query;
        if (typeof projectId !== "string" || !mongoose.isObjectIdOrHexString(projectId)) {
            return res.status(400).json({ success: false, message: "A valid project ID is required." });
        }
        await readableProject(projectId, req.user.id);
        const { page, limit, skip } = pagination(req.query);
        const [uploads, total] = await Promise.all([
            Asset.find({ projectId }).sort({ uploadedAt: -1 }).skip(skip).limit(limit).lean(),
            Asset.countDocuments({ projectId }),
        ]);
        return res.status(200).json({ success: true, data: uploads, meta: pageMeta(page, limit, total) });
    } catch (error) {
        return sendError(res, error);
    }
};

const deleteAsset = async (req, res) => {
    try {
        requireId(req.params.id, "asset ID");
        const owner = await Asset.findById(req.params.id).select("projectId").lean();
        if (!owner) return res.status(404).json({ success: false, message: "Asset not found." });
        let thumbnailFilename = "";
        await withProject(owner.projectId, async (project, session) => {
            const asset = await Asset.findOne({ _id: req.params.id, projectId: project._id }).session(session);
            if (!asset) fail(404, "Asset not found.");
            thumbnailFilename = asset.thumbnailFilename || "";
            // The file itself is only removed once nothing else references it
            // (see services/fileCleanup.js), so a shared/legacy file is kept.
            await PendingFileDeletion.create([{ filename: asset.filename }], { session });
            if (thumbnailFilename) await PendingFileDeletion.create([{ filename: thumbnailFilename }], { session });
            await Asset.deleteOne({ _id: asset._id }, { session });
        }, { ownerId: req.user.id });
        let cleanupPending = false;
        try { await processPendingFiles(); cleanupPending = !!await PendingFileDeletion.exists({}); }
        catch (error) { cleanupPending = true; req.log?.error({ err: error }, "Upload cleanup deferred"); }
        res.json({ success: true, message: "Asset deleted successfully", ...(cleanupPending ? { cleanupPending: true } : {}) });
    } catch (error) { sendError(res, error); }
};

module.exports = { uploadImage, getUploads, deleteAsset };
