const mongoose = require("mongoose");
const Project = require("../models/Project");
const Scene = require("../models/Scene");
const Asset = require("../models/Asset");

// Keep in sync with the `access` enum in models/Scene.js.
const ACCESS_MODES = ["flat", "stairs", "ramp", "elevator", "door", "escalator"];

function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

function requireId(value, label = "ID") {
    if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value)) {
        fail(400, `A valid ${label} is required.`);
    }
    return value.toLowerCase();
}

function pickFields(body, allowed) {
    if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "A JSON object is required.");
    for (const key of Object.keys(body)) {
        if (!allowed.includes(key)) fail(400, `Field '${key}' cannot be changed here.`);
    }
    return { ...body };
}

function sendError(res, error) {
    const validation = ["ValidationError", "CastError", "StrictModeError"].includes(error.name);
    return res.status(error.status || (validation ? 400 : 500)).json({ success: false, message: error.message });
}

async function transaction(work) {
    try {
        return await mongoose.connection.transaction(work);
    } catch (error) {
        // Never fall back to non-atomic writes on a standalone MongoDB server.
        if (error.code === 20 || error.codeName === "IllegalOperation") {
            fail(503, "This operation requires MongoDB transactions. Use a replica set (including a single-node local replica set) or MongoDB Atlas.");
        }
        throw error;
    }
}

async function lockProject(projectId, session, ownerId) {
    // Every dependent writer touches this document. A delete racing a scene,
    // connection, upload or event causes a write conflict and transaction retry.
    // Scoping the filter by ownerId makes the ownership check part of the same
    // atomic read, so it cannot be raced by a concurrent transfer.
    const filter = { _id: projectId };
    if (ownerId) filter.ownerId = ownerId;
    const project = await Project.findOneAndUpdate(
        filter, { $inc: { __v: 1 } }, { session, returnDocument: "after" }
    );
    // Deliberately 404 rather than 403: a project belonging to someone else
    // must be indistinguishable from one that does not exist.
    if (!project) fail(404, "Project not found.");
    return project;
}

/**
 * Runs `work` against a locked project inside a transaction.
 * @param {string} projectId
 * @param {(project, session) => Promise<any>} work
 * @param {{ ownerId?: string }} [options] - when ownerId is given, a project
 *   owned by anyone else is reported as missing.
 */
async function withProject(projectId, work, options = {}) {
    requireId(String(projectId), "project ID");
    return transaction(async (session) => {
        const project = await lockProject(projectId, session, options.ownerId);
        return work(project, session);
    });
}

async function withScene(sceneId, work, options = {}) {
    requireId(sceneId, "scene ID");
    // Only discover the owning project here. Re-read the scene under the lock.
    const owner = await Scene.findById(sceneId).select("projectId").lean();
    if (!owner) fail(404, "Scene not found.");
    return withProject(owner.projectId, async (project, session) => {
        const scene = await Scene.findOne({ _id: sceneId, projectId: project._id }).session(session);
        if (!scene) fail(404, "Scene not found.");
        return work(scene, session, project);
    }, options);
}

/**
 * Confirms a project exists and belongs to `ownerId`, without opening a
 * transaction. For read paths that do not mutate anything.
 * @returns {Promise<object>} the project document (lean).
 */
async function readableProject(projectId, ownerId) {
    requireId(String(projectId), "project ID");
    const filter = { _id: projectId };
    if (ownerId) filter.ownerId = ownerId;
    const project = await Project.findOne(filter).lean();
    if (!project) fail(404, "Project not found.");
    return project;
}

/**
 * Reads page/limit from a query string, clamped so a client cannot ask for an
 * unbounded result set.
 */
function pagination(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const requested = Number.parseInt(query.limit, 10);
    const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(requested) ? requested : defaultLimit));
    return { page, limit, skip: (page - 1) * limit };
}

function pageMeta(page, limit, total) {
    return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), hasMore: page * limit < total };
}

async function validateAssetPath(value, projectId, session) {
    if (value === "" || value === null) return "";
    if (typeof value !== "string") fail(400, "Image path must be a string.");
    let assetPath = value;
    if (/^https?:\/\//i.test(value)) {
        let url;
        try { url = new URL(value); } catch { fail(400, "Invalid image URL."); }
        // Preserve external image URLs, but do not bypass ownership checks by
        // passing an absolute URL for an application upload.
        if (!url.pathname.startsWith("/uploads/")) return value;
        assetPath = url.pathname;
    }
    if (assetPath.startsWith("uploads/")) assetPath = `/${assetPath}`;
    if (!/^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetPath)) fail(400, "Invalid uploaded image path.");
    if (!await Asset.exists({ projectId, path: assetPath }).session(session)) {
        fail(400, "The image must be an existing asset belonging to this project.");
    }
    return assetPath;
}

async function validateHotspots(hotspots, scene, session) {
    if (!Array.isArray(hotspots)) fail(400, "Hotspots must be an array.");
    const seen = new Set();
    for (const spot of hotspots) {
        pickFields(spot, ["_id", "targetScene", "label", "yaw", "pitch", "distance", "access"]);
        if (spot.access !== undefined && !ACCESS_MODES.includes(spot.access)) {
            fail(400, `access must be one of: ${ACCESS_MODES.join(", ")}.`);
        }
        const target = requireId(String(spot.targetScene || ""), "target scene ID");
        if (target === String(scene._id)) fail(400, "A scene cannot connect to itself.");
        if (seen.has(target)) fail(400, "Hotspot already exists.");
        seen.add(target);
        for (const key of ["yaw", "pitch", "distance"]) {
            if (spot[key] !== undefined && (spot[key] === null || spot[key] === "" || !Number.isFinite(Number(spot[key])))) {
                fail(400, `${key} must be a finite number.`);
            }
        }
        if (spot.distance !== undefined && Number(spot.distance) < 0) fail(400, "Distance cannot be negative.");
    }
    const count = await Scene.countDocuments({ _id: { $in: [...seen] }, projectId: scene.projectId }).session(session);
    if (count !== seen.size) fail(400, "Every hotspot must target an existing scene in the same project.");
}

async function validateEvent(data, session) {
    for (const value of [data.sceneId, data.metadata?.fromSceneId]) {
        if (value === undefined) continue;
        requireId(value, "scene ID");
        if (!await Scene.exists({ _id: value, projectId: data.projectId }).session(session)) {
            fail(400, "Event scenes must exist in the same project.");
        }
    }
}

module.exports = { ACCESS_MODES, fail, requireId, pickFields, sendError, transaction, withProject, withScene, readableProject, pagination, pageMeta, validateAssetPath, validateHotspots, validateEvent };
