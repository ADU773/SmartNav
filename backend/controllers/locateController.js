const sharp = require("sharp");
const Project = require("../models/Project");
const Scene = require("../models/Scene");
const SceneEmbedding = require("../models/SceneEmbedding");
const { requireId, fail, sendError, readableProject } = require("../services/integrity");
const { ensureProjectIndex, locateInProject } = require("../services/placeIndex");
const { modelVersion } = require("../services/placeModel");

/**
 * Resolves which project a locate request is about, and whether the caller
 * may see it: the signed-in owner by project ID, or anyone holding the share
 * token of a published tour.
 */
async function projectForRequest(req) {
    const { projectId, shareToken } = req.body || {};
    if (shareToken) {
        if (typeof shareToken !== "string" || !/^[a-f0-9]{16,64}$/i.test(shareToken)) fail(404, "Published project not found.");
        const project = await Project.findOne({ shareToken, published: true }).select("_id").lean();
        if (!project) fail(404, "Published project not found.");
        return project._id;
    }
    if (!req.user) fail(401, "Sign in to continue.");
    requireId(String(projectId || ""), "project ID");
    const project = await readableProject(projectId, req.user.id);
    return project._id;
}

/**
 * POST /api/locate  (multipart: image, and projectId or shareToken)
 * Returns the scenes ranked by how well they match the photo, each with the
 * estimated heading in Marzipano yaw degrees.
 */
const locate = async (req, res) => {
    try {
        const projectId = await projectForRequest(req);
        if (!req.file) fail(400, "Take or choose a photo to locate.");
        // The bytes must decode as an image; the MIME header is client-supplied.
        try {
            await sharp(req.file.buffer).metadata();
        } catch {
            fail(400, "That file is not an image this server can read.");
        }

        const result = await locateInProject(projectId, req.file.buffer);
        if (!result.indexedScenes) {
            fail(409, result.sceneCount
                ? "None of this project's scenes could be indexed for location yet."
                : "This project has no scenes with panoramas to compare against.");
        }

        const names = new Map((await Scene.find({ projectId }).select("name image").lean())
            .map((scene) => [String(scene._id), scene]));
        const matches = result.matches.slice(0, 3).map((match) => ({
            ...match,
            name: names.get(match.sceneId)?.name || "Unknown scene",
            image: names.get(match.sceneId)?.image || "",
        }));

        res.json({
            success: true,
            data: {
                matches,
                indexedScenes: result.indexedScenes,
                newlyIndexed: result.newlyIndexed,
                skipped: result.skipped,
            },
        });
    } catch (error) { sendError(res, error); }
};

/**
 * POST /api/locate/projects/:projectId/index
 * Builds the index ahead of time so a visitor's first "Where am I?" is fast.
 */
const buildIndex = async (req, res) => {
    try {
        requireId(req.params.projectId, "project ID");
        await readableProject(req.params.projectId, req.user.id);
        const result = await ensureProjectIndex(req.params.projectId);
        res.json({
            success: true,
            data: { indexedScenes: result.index.length, sceneCount: result.sceneCount, newlyIndexed: result.built, skipped: result.skipped },
        });
    } catch (error) { sendError(res, error); }
};

/** GET /api/locate/projects/:projectId/status — how much of the project is indexed. */
const indexStatus = async (req, res) => {
    try {
        requireId(req.params.projectId, "project ID");
        await readableProject(req.params.projectId, req.user.id);
        const scenes = await Scene.find({ projectId: req.params.projectId, image: { $nin: ["", null] } }).select("_id image").lean();
        const entries = await SceneEmbedding.find({ projectId: req.params.projectId }).select("sceneId image modelVersion").lean();
        const current = new Map(entries.map((entry) => [String(entry.sceneId), entry]));
        const version = modelVersion();
        const upToDate = scenes.filter((scene) => {
            const entry = current.get(String(scene._id));
            return entry && entry.image === scene.image && entry.modelVersion === version;
        }).length;
        res.json({ success: true, data: { scenesWithImages: scenes.length, indexed: upToDate, pending: scenes.length - upToDate } });
    } catch (error) { sendError(res, error); }
};

module.exports = { locate, buildIndex, indexStatus };
