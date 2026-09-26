const Scene = require("../models/Scene");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const { requireId, pickFields, sendError, fail, withProject, withScene, readableProject, pagination, pageMeta, validateAssetPath, validateHotspots } = require("../services/integrity");

const HOTSPOT_FIELDS = ["targetSceneId", "label", "yaw", "pitch", "distance", "access"];

const createScene = async (req, res) => {
    try {
        const data = pickFields(req.body, ["projectId", "name", "image", "hotspots", "metadata", "mapPosition"]);
        requireId(data.projectId, "project ID");
        const scene = await withProject(data.projectId, async (project, session) => {
            const current = new Scene({ ...data, projectId: project._id });
            if (data.image !== undefined) current.image = await validateAssetPath(data.image, project._id, session);
            if (data.hotspots !== undefined) await validateHotspots(data.hotspots, current, session);
            return current.save({ session });
        }, { ownerId: req.user.id });
        res.status(201).json({ success: true, message: "Scene created successfully", data: scene });
    } catch (error) { sendError(res, error); }
};

const getScenes = async (req, res) => {
    try {
        const { projectId } = req.query;
        // Scenes are only ever listed within a project the caller owns; an
        // unscoped list would return every tenant's scenes.
        if (projectId === undefined) fail(400, "A project ID is required.");
        requireId(projectId, "project ID");
        await readableProject(projectId, req.user.id);
        const { page, limit, skip } = pagination(req.query, { defaultLimit: 100 });
        const [scenes, total] = await Promise.all([
            Scene.find({ projectId }).sort({ createdAt: 1 }).skip(skip).limit(limit),
            Scene.countDocuments({ projectId }),
        ]);
        res.json({ success: true, count: scenes.length, data: scenes, meta: pageMeta(page, limit, total) });
    } catch (error) { sendError(res, error); }
};

const getSceneById = async (req, res) => {
    try {
        requireId(req.params.id, "scene ID");
        const scene = await Scene.findById(req.params.id).populate("projectId", "name ownerId");
        if (!scene) fail(404, "Scene not found");
        if (String(scene.projectId?.ownerId) !== req.user.id) fail(404, "Scene not found");
        res.json({ success: true, data: scene });
    } catch (error) { sendError(res, error); }
};

const deleteScene = async (req, res) => {
    try {
        await withScene(req.params.id, async (scene, session) => {
            await Scene.updateMany({ "hotspots.targetScene": scene._id }, { $pull: { hotspots: { targetScene: scene._id } } }, { session });
            await AnalyticsEvent.deleteMany({ $or: [
                { sceneId: scene._id }, { "metadata.fromSceneId": { $in: [scene._id, String(scene._id)] } },
            ] }, { session });
            await Scene.deleteOne({ _id: scene._id }, { session });
            // Images are project-owned reusable assets, not scene-owned files.
        }, { ownerId: req.user.id });
        res.json({ success: true, message: "Scene deleted successfully" });
    } catch (error) { sendError(res, error); }
};

const connectScenes = async (req, res) => {
    try {
        const data = pickFields(req.body, HOTSPOT_FIELDS);
        requireId(data.targetSceneId, "target scene ID");
        const scene = await withScene(req.params.id, async (current, session) => {
            const hotspot = {
                targetScene: data.targetSceneId, label: data.label,
                yaw: data.yaw ?? 0, pitch: data.pitch ?? 0, distance: data.distance ?? 0,
                access: data.access ?? "flat",
            };
            const hotspots = [...current.hotspots.map((spot) => spot.toObject()), hotspot];
            await validateHotspots(hotspots, current, session);
            current.hotspots.push(hotspot);
            return current.save({ session });
        }, { ownerId: req.user.id });
        res.json({ success: true, message: "Scenes connected successfully.", data: scene });
    } catch (error) { sendError(res, error); }
};

const updateScene = async (req, res) => {
    try {
        const data = pickFields(req.body, ["projectId", "name", "image", "hotspots", "metadata", "mapPosition"]);
        const scene = await withScene(req.params.id, async (current, session) => {
            const update = { ...data };
            if (update.projectId !== undefined) {
                if (requireId(update.projectId, "project ID") !== String(current.projectId)) fail(400, "Moving a scene to another project is not supported.");
                delete update.projectId;
            }
            if (update.image !== undefined) update.image = await validateAssetPath(update.image, current.projectId, session);
            if (update.hotspots !== undefined) await validateHotspots(update.hotspots, current, session);
            current.set(update);
            return current.save({ session });
        }, { ownerId: req.user.id });
        res.json({ success: true, message: "Scene updated successfully", data: scene });
    } catch (error) { sendError(res, error); }
};

module.exports = { createScene, getScenes, getSceneById, updateScene, deleteScene, connectScenes };
