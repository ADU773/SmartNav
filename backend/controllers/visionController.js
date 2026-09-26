const Scene = require("../models/Scene");
const Project = require("../models/Project");
const { requireId, fail, sendError } = require("../services/integrity");
const { detectObjectsInScene } = require("../services/objectIndex");
const { localFileFor } = require("../services/placeIndex");

const REMOTE_TIMEOUT_MS = 120000;
// Bounds on what a remote detector can put into a scene (and from there into
// the AI assistant's prompt).
const REMOTE_MAX_DETECTIONS = 500;
const REMOTE_MAX_LABEL_LENGTH = 60;

/**
 * Remote detector, kept for anyone already running one: POST { imageUrl,
 * sceneId } to YOLO_API_URL and read back { detections | results: [{ label |
 * name | class, confidence | score }] }. Returns labels only, with no
 * directions.
 */
async function detectRemotely(scene) {
    // The image URL is built from configuration, never from request headers,
    // so a caller cannot point the detection service at a host they choose.
    const base = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, "");
    let response;
    try {
        response = await fetch(process.env.YOLO_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: `${base}${scene.image}`, sceneId: String(scene._id) }),
            signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
        });
    } catch {
        fail(502, "The object-detection service could not be reached.");
    }
    if (!response.ok) fail(502, "The object-detection service did not accept the image.");
    const result = await response.json().catch(() => fail(502, "The object-detection service sent a reply that could not be read."));
    const items = Array.isArray(result?.detections) ? result.detections : Array.isArray(result?.results) ? result.results : [];
    const detections = items
        // Ultralytics-style replies carry the name in `name` and a numeric
        // class ID in `class`; class 0 (person) must not be dropped as falsy.
        .map((item) => ({
            label: String(item?.label ?? item?.name ?? item?.class ?? "").trim().slice(0, REMOTE_MAX_LABEL_LENGTH),
            confidence: Number(item?.confidence ?? item?.score ?? 0) || 0,
        }))
        .filter((item) => item.label)
        .slice(0, REMOTE_MAX_DETECTIONS);
    return { detections, viewsScanned: null, modelVersion: "remote" };
}

/**
 * POST /api/vision/detect { sceneId }
 * Detects objects in a scene's panorama, stores them on the scene with the
 * direction each one sits in, and adds their names to the scene's tags so the
 * AI assistant and search can use them.
 */
const detectObjects = async (req, res) => {
    try {
        const { sceneId } = req.body || {};
        requireId(String(sceneId || ""), "scene ID");
        const scene = await Scene.findById(sceneId).select("projectId image").lean();
        if (!scene) fail(404, "Scene not found.");
        // Detection writes to the scene, so it is an owner-only operation.
        if (!await Project.exists({ _id: scene.projectId, ownerId: req.user.id })) fail(404, "Scene not found.");
        if (!scene.image) fail(400, "Give this scene a panorama before detecting objects.");
        if (!localFileFor(scene.image)) fail(400, "This scene's image is not an uploaded file, so it cannot be scanned.");

        const result = process.env.YOLO_API_URL ? await detectRemotely(scene) : await detectObjectsInScene(scene);
        const labels = [...new Set(result.detections.map((item) => item.label))];

        // Saved only if the scene still shows the panorama that was scanned, so
        // an image replaced mid-scan never inherits the old image's objects.
        const saved = await Scene.updateOne(
            { _id: scene._id, image: scene.image },
            {
                $set: {
                    detections: result.detections,
                    objectScan: { modelVersion: result.modelVersion, scannedAt: new Date(), image: scene.image },
                },
                $addToSet: { metadata: { $each: labels } },
            },
            { runValidators: true },
        );
        if (saved.matchedCount === 0) {
            if (!await Scene.exists({ _id: scene._id })) fail(404, "Scene not found.");
            fail(409, "This scene's panorama was changed during the scan. Scan it again.");
        }

        const counts = new Map();
        for (const item of result.detections) counts.set(item.label, (counts.get(item.label) || 0) + 1);
        res.json({
            success: true,
            data: {
                detections: result.detections,
                labels,
                counts: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
                viewsScanned: result.viewsScanned,
                modelVersion: result.modelVersion,
            },
        });
    } catch (error) { sendError(res, error); }
};

module.exports = { detectObjects };
