const fs = require("fs/promises");
const mongoose = require("mongoose");
const Asset = require("../models/Asset");
const PendingFileDeletion = require("../models/PendingFileDeletion");
const { withProject, requireId, fail, sendError } = require("../services/integrity");
const { validateImage } = require("../middleware/uploadMiddleware");
const { processPendingFiles } = require("../services/fileCleanup");

const uploadImage = async (req, res) => {
    let asset;
    let uncertainCommit = false;
    try {
        const { projectId } = req.body || {};
        if (typeof projectId !== "string" || !mongoose.isObjectIdOrHexString(projectId)) {
            return res.status(400).json({ success: false, message: "A valid project ID is required." });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Select an image file to upload." });
        }
        await validateImage(req.file);
        asset = await withProject(projectId, async (_project, session) => {
            const [created] = await Asset.create([{
                projectId,
                filename: req.file.filename,
                originalName: req.file.originalname,
                path: `/uploads/${req.file.filename}`,
            }], { session });
            return created;
        });
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
                if (cleanupError.code !== "ENOENT") console.error("Failed to remove rejected upload:", cleanupError);
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
        const uploads = await Asset.find({ projectId });
        return res.status(200).json({ success: true, data: uploads });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteAsset = async (req, res) => {
    try {
        requireId(req.params.id, "asset ID");
        const owner = await Asset.findById(req.params.id).select("projectId").lean();
        if (!owner) return res.status(404).json({ success: false, message: "Asset not found." });
        await withProject(owner.projectId, async (project, session) => {
            const asset = await Asset.findOne({ _id: req.params.id, projectId: project._id }).session(session);
            if (!asset) fail(404, "Asset not found.");
            // The file itself is only removed once nothing else references it
            // (see services/fileCleanup.js), so a shared/legacy file is kept.
            await PendingFileDeletion.create([{ filename: asset.filename }], { session });
            await Asset.deleteOne({ _id: asset._id }, { session });
        });
        let cleanupPending = false;
        try { await processPendingFiles(); cleanupPending = !!await PendingFileDeletion.exists({}); }
        catch (error) { cleanupPending = true; console.error("Upload cleanup deferred:", error.message); }
        res.json({ success: true, message: "Asset deleted successfully", ...(cleanupPending ? { cleanupPending: true } : {}) });
    } catch (error) { sendError(res, error); }
};

module.exports = { uploadImage, getUploads, deleteAsset };
