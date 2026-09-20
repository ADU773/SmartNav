const Project = require("../models/Project");
const Scene = require("../models/Scene");
const Asset = require("../models/Asset");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const PendingFileDeletion = require("../models/PendingFileDeletion");
const { requireId, pickFields, sendError, withProject, validateAssetPath, fail } = require("../services/integrity");
const { processPendingFiles } = require("../services/fileCleanup");

const createProject = async (req, res) => {
    try {
        const data = pickFields(req.body, ["name", "description", "floorPlan"]);
        // A project cannot own uploaded assets before it has been created.
        if (data.floorPlan) fail(400, "Create the project and upload its floor plan before assigning it.");
        const project = await Project.create(data);
        res.status(201).json({ success: true, message: "Project created successfully", data: project });
    } catch (error) { sendError(res, error); }
};

const getProjects = async (req, res) => {
    try {
        const projects = await Project.find().sort({ createdAt: -1 });
        res.json({ success: true, message: "Projects fetched successfully", data: projects });
    } catch (error) { sendError(res, error); }
};

const getProject = async (req, res) => {
    try {
        requireId(req.params.id, "project ID");
        const project = await Project.findById(req.params.id);
        if (!project) fail(404, "Project not found");
        res.json({ success: true, data: project });
    } catch (error) { sendError(res, error); }
};

const updateProject = async (req, res) => {
    try {
        requireId(req.params.id, "project ID");
        const data = pickFields(req.body, ["name", "description", "floorPlan"]);
        const project = await withProject(req.params.id, async (current, session) => {
            const update = { ...data };
            if (update.floorPlan !== undefined) update.floorPlan = await validateAssetPath(update.floorPlan, current._id, session);
            current.set(update);
            return current.save({ session });
        });
        res.json({ success: true, message: "Project updated successfully", data: project });
    } catch (error) { sendError(res, error); }
};

const deleteProject = async (req, res) => {
    try {
        requireId(req.params.id, "project ID");
        await withProject(req.params.id, async (project, session) => {
            const scenes = await Scene.find({ projectId: project._id }).select("_id").session(session).lean();
            const ids = scenes.map((scene) => scene._id);
            const references = [...ids, ...ids.map(String)];
            const assets = await Asset.find({ projectId: project._id }).session(session).lean();
            await Scene.updateMany({ "hotspots.targetScene": { $in: ids } }, { $pull: { hotspots: { targetScene: { $in: ids } } } }, { session });
            // Repair legacy references from other projects to assets being removed.
            // If another asset record owns the same file, retain that shared file.
            const paths = [];
            for (const asset of assets) {
                if (!await Asset.exists({ projectId: { $ne: project._id }, $or: [{ filename: asset.filename }, { path: asset.path }] }).session(session)) {
                    paths.push(asset.path, asset.path.replace(/^\//, ""));
                    const escaped = asset.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    paths.push(new RegExp(`^https?://[^/]+${escaped}(?:[?#].*)?$`, "i"));
                }
            }
            if (paths.length) {
                await Scene.updateMany({ projectId: { $ne: project._id }, image: { $in: paths } }, { $set: { image: "" } }, { session });
                await Project.updateMany({ _id: { $ne: project._id }, floorPlan: { $in: paths } }, { $set: { floorPlan: "" } }, { session });
            }
            await AnalyticsEvent.deleteMany({ $or: [
                { projectId: project._id }, { sceneId: { $in: ids } }, { "metadata.fromSceneId": { $in: references } },
            ] }, { session });
            await Scene.deleteMany({ projectId: project._id }, { session });
            if (assets.length) await PendingFileDeletion.insertMany(assets.map((asset) => ({ filename: asset.filename })), { session });
            await Asset.deleteMany({ projectId: project._id }, { session });
            await Project.deleteOne({ _id: project._id }, { session });
        });
        // Files are removed only AFTER commit. Failures remain in the durable
        // queue, so a filesystem error cannot turn a rolled-back DB into data loss.
        let cleanupPending = false;
        try { await processPendingFiles(); cleanupPending = !!await PendingFileDeletion.exists({}); }
        catch (error) { cleanupPending = true; console.error("Upload cleanup deferred:", error.message); }
        res.json({ success: true, message: "Project deleted successfully", ...(cleanupPending ? { cleanupPending: true } : {}) });
    } catch (error) { sendError(res, error); }
};

module.exports = { createProject, getProjects, getProject, updateProject, deleteProject };
