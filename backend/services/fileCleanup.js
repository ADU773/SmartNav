const fs = require("fs/promises");
const path = require("path");
const PendingFileDeletion = require("../models/PendingFileDeletion");
const Asset = require("../models/Asset");
const Scene = require("../models/Scene");
const Project = require("../models/Project");

const uploadDirectory = path.resolve(__dirname, "../uploads");

function resolveUploadFile(filename) {
    if (typeof filename !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) {
        throw new Error("Refusing to delete an unsafe upload filename.");
    }
    const target = path.resolve(uploadDirectory, filename);
    if (path.dirname(target) !== uploadDirectory) throw new Error("Upload path escapes the uploads directory.");
    return target;
}

async function processPendingFiles() {
    const jobs = await PendingFileDeletion.find({ retryAt: { $lte: new Date() } }).sort({ retryAt: 1 }).limit(100).lean();
    let pending = 0;
    for (const job of jobs) {
        try {
            const target = resolveUploadFile(job.filename);
            const imagePath = `/uploads/${job.filename}`;
            // Preserve legacy shared files while any surviving entity owns/uses
            // them. New references can only be made to an existing owned asset.
            if (await Asset.exists({ $or: [{ filename: job.filename }, { path: imagePath }] }) ||
                await Scene.exists({ image: imagePath }) || await Project.exists({ floorPlan: imagePath })) {
                pending++;
                await PendingFileDeletion.updateOne({ _id: job._id }, { $set: { retryAt: new Date(Date.now() + 60000) } });
                continue;
            }
            try { await fs.unlink(target); }
            catch (error) { if (error.code !== "ENOENT") throw error; }
            await PendingFileDeletion.deleteOne({ _id: job._id });
        } catch (error) {
            pending++;
            await PendingFileDeletion.updateOne({ _id: job._id }, { $set: { retryAt: new Date(Date.now() + 60000) } });
            console.error(`Upload cleanup pending for ${job._id}:`, error.message);
        }
    }
    return pending;
}

module.exports = { processPendingFiles, resolveUploadFile };
