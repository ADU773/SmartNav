const Project = require("../models/Project");
const Scene = require("../models/Scene");
const Asset = require("../models/Asset");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const PendingFileDeletion = require("../models/PendingFileDeletion");
const { requireId, pickFields, sendError, withProject, pagination, pageMeta, validateAssetPath, fail } = require("../services/integrity");
const { processPendingFiles } = require("../services/fileCleanup");

const createProject = async (req, res) => {
    try {
        const data = pickFields(req.body, ["name", "description", "floorPlan"]);
        // A project cannot own uploaded assets before it has been created.
        if (data.floorPlan) fail(400, "Create the project and upload its floor plan before assigning it.");
        // ownerId comes from the verified access token, never from the body.
        const project = await Project.create({ ...data, ownerId: req.user.id });
        res.status(201).json({ success: true, message: "Project created successfully", data: project });
    } catch (error) { sendError(res, error); }
};

const getProjects = async (req, res) => {
    try {
        const filter = { ownerId: req.user.id };
        const { page, limit, skip } = pagination(req.query, { defaultLimit: 100 });
        const [projects, total] = await Promise.all([
            Project.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Project.countDocuments(filter),
        ]);
        res.json({ success: true, message: "Projects fetched successfully", data: projects, meta: pageMeta(page, limit, total) });
    } catch (error) { sendError(res, error); }
};

const getProject = async (req, res) => {
    try {
        requireId(req.params.id, "project ID");
        const project = await Project.findOne({ _id: req.params.id, ownerId: req.user.id });
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
        }, { ownerId: req.user.id });
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
            if (assets.length) {
                // Queue the derived thumbnails alongside their originals, or
                // they outlive the project as orphaned files.
                const doomed = assets.flatMap((asset) => [
                    { filename: asset.filename },
                    ...(asset.thumbnailFilename ? [{ filename: asset.thumbnailFilename }] : []),
                ]);
                await PendingFileDeletion.insertMany(doomed, { session });
            }
            await Asset.deleteMany({ projectId: project._id }, { session });
            await Project.deleteOne({ _id: project._id }, { session });
        }, { ownerId: req.user.id });
        // Files are removed only AFTER commit. Failures remain in the durable
        // queue, so a filesystem error cannot turn a rolled-back DB into data loss.
        let cleanupPending = false;
        try { await processPendingFiles(); cleanupPending = !!await PendingFileDeletion.exists({}); }
        catch (error) { cleanupPending = true; req.log?.error({ err: error }, "Upload cleanup deferred"); }
        res.json({ success: true, message: "Project deleted successfully", ...(cleanupPending ? { cleanupPending: true } : {}) });
    } catch (error) { sendError(res, error); }
};

module.exports = { createProject, getProjects, getProject, updateProject, deleteProject };
