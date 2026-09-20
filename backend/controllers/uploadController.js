const fs = require("fs/promises");
const mongoose = require("mongoose");
const Asset = require("../models/Asset");
const Project = require("../models/Project");
const { validateImage } = require("../middleware/uploadMiddleware");

const uploadImage = async (req, res) => {
    let asset;
    try {
        const { projectId } = req.body || {};
        if (typeof projectId !== "string" || !mongoose.isObjectIdOrHexString(projectId)) {
            return res.status(400).json({ success: false, message: "A valid project ID is required." });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Select an image file to upload." });
        }
        await validateImage(req.file);
        if (!await Project.exists({ _id: projectId })) {
            return res.status(404).json({ success: false, message: "Project not found." });
        }
        asset = await Asset.create({
            projectId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: `/uploads/${req.file.filename}`,
        });
        return res.status(200).json({ success: true, data: asset });
    } catch (error) {
        return res.status(error.status || 500).json({ success: false, message: error.message });
    } finally {
        // Multer cleans up its own parsing errors. Once it hands off to this
        // controller, remove the file unless its asset record was saved.
        if (req.file && !asset) {
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

module.exports = { uploadImage, getUploads };
