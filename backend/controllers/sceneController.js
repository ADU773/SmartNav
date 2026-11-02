const Scene = require("../models/Scene");
const Asset = require("../models/Asset");
const { DEFAULT_PITCH, normalizeAngle, mapBearing, mapDistanceMeters, hotspotYaw, estimateOffset } = require("../services/mapLinks");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const SceneEmbedding = require("../models/SceneEmbedding");
const { requireId, pickFields, sendError, fail, withProject, withScene, readableProject, pagination, pageMeta, validateAssetPath, validateHotspots } = require("../services/integrity");

const HOTSPOT_FIELDS = ["targetSceneId", "label", "yaw", "pitch", "distance", "access"];
const SCENE_FIELDS = ["projectId", "name", "image", "hotspots", "metadata", "mapPosition", "mapYawOffset"];

/** Checks and wraps a map direction (radians); null clears it. */
function checkMapYawOffset(data) {
    if (data.mapYawOffset === undefined || data.mapYawOffset === null) return;
    if (!Number.isFinite(data.mapYawOffset)) fail(400, "mapYawOffset must be an angle in radians.");
    data.mapYawOffset = normalizeAngle(data.mapYawOffset);
}

const createScene = async (req, res) => {
    try {
        const data = pickFields(req.body, SCENE_FIELDS);
        checkMapYawOffset(data);
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
            await SceneEmbedding.deleteOne({ sceneId: scene._id }, { session });
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
        const data = pickFields(req.body, SCENE_FIELDS);
        checkMapYawOffset(data);
        const scene = await withScene(req.params.id, async (current, session) => {
            const update = { ...data };
            if (update.projectId !== undefined) {
                if (requireId(update.projectId, "project ID") !== String(current.projectId)) fail(400, "Moving a scene to another project is not supported.");
                delete update.projectId;
            }
            if (update.image !== undefined) update.image = await validateAssetPath(update.image, current.projectId, session);
            if (update.hotspots !== undefined) await validateHotspots(update.hotspots, current, session);
            // Detected objects describe the old panorama; drop them with it.
            if (update.image !== undefined && update.image !== current.image) {
                current.detections = [];
                current.objectScan = undefined;
            }
            current.set(update);
            return current.save({ session });
        }, { ownerId: req.user.id });
        res.json({ success: true, message: "Scene updated successfully", data: scene });
    } catch (error) { sendError(res, error); }
};

/**
 * Links two scenes from the floor plan: computes each hotspot's direction from
 * the pins and each scene's map direction, and the distance from the floor
 * plan's scale, then adds (or updates) the hotspot in both scenes at once.
 */
const linkScenes = async (req, res) => {
    try {
        const data = pickFields(req.body, ["targetSceneId", "access", "label", "twoWay"]);
        const targetId = requireId(data.targetSceneId, "target scene ID");
        const access = data.access ?? "flat";
        const twoWay = data.twoWay !== false;
        const result = await withScene(req.params.id, async (source, session, project) => {
            if (String(source._id) === targetId) fail(400, "A scene cannot connect to itself.");
            const target = await Scene.findOne({ _id: targetId, projectId: project._id }).session(session);
            if (!target) fail(400, "Every hotspot must target an existing scene in the same project.");
            for (const scene of [source, target]) {
                if (!scene.mapPosition) fail(400, `Place "${scene.name}" on the floor plan first.`);
            }

            // The floor plan's shape keeps angles true on a non-square image.
            const plan = project.floorPlan
                ? await Asset.findOne({ projectId: project._id, path: project.floorPlan }).select("width height").session(session).lean()
                : null;
            const aspect = plan?.width > 0 && plan?.height > 0 ? plan.height / plan.width : 1;
            const placed = await Scene.find({ projectId: project._id, mapPosition: { $exists: true } }).select("mapPosition").session(session).lean();
            const positions = new Map(placed.map((scene) => [String(scene._id), scene.mapPosition]));

            const offsetOf = (scene) => {
                if (Number.isFinite(scene.mapYawOffset)) return { offset: scene.mapYawOffset, from: "set" };
                const estimated = estimateOffset(scene, positions, aspect);
                if (estimated !== null) return { offset: estimated, from: "existing hotspots" };
                fail(400, `Set the map direction of "${scene.name}" first: turn its 360° view to face the top of the floor plan.`);
            };
            const sourceDir = offsetOf(source);
            const targetDir = twoWay ? offsetOf(target) : null;
            const distance = mapDistanceMeters(source.mapPosition, target.mapPosition, aspect, project.floorPlanWidthMeters);

            const upsert = async (scene, toScene, yaw) => {
                const hotspots = scene.hotspots.map((spot) => spot.toObject());
                const index = hotspots.findIndex((spot) => String(spot.targetScene) === String(toScene._id));
                const linked = {
                    targetScene: toScene._id,
                    label: data.label ?? (index >= 0 ? hotspots[index].label : ""),
                    yaw,
                    pitch: index >= 0 ? hotspots[index].pitch : DEFAULT_PITCH,
                    distance: distance ?? (index >= 0 ? hotspots[index].distance : 0),
                    access,
                };
                if (index >= 0) hotspots[index] = { ...hotspots[index], ...linked };
                else hotspots.push(linked);
                await validateHotspots(hotspots, scene, session);
                scene.hotspots = hotspots;
                return scene.save({ session });
            };

            const bearing = mapBearing(source.mapPosition, target.mapPosition, aspect);
            const savedSource = await upsert(source, target, hotspotYaw(bearing, sourceDir.offset));
            const savedTarget = twoWay ? await upsert(target, source, hotspotYaw(bearing + Math.PI, targetDir.offset)) : target;
            return {
                source: savedSource,
                target: savedTarget,
                distance,
                directions: { [source.name]: sourceDir.from, ...(twoWay ? { [target.name]: targetDir.from } : {}) },
            };
        }, { ownerId: req.user.id });
        res.json({ success: true, message: "Scenes linked from the map.", data: result });
    } catch (error) { sendError(res, error); }
};

module.exports = { createScene, getScenes, getSceneById, updateScene, deleteScene, connectScenes, linkScenes };
