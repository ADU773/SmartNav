/**
 * Builds and queries the per-project place-recognition index.
 *
 * Indexing is lazy and incremental: a scene is (re)indexed only when it has
 * no embedding yet, its image changed, or the model changed. The first
 * "Where am I?" in a project therefore pays for indexing (about a second per
 * scene); later ones are a single embedding plus a comparison.
 */

const sharp = require("sharp");
const Scene = require("../models/Scene");
const SceneEmbedding = require("../models/SceneEmbedding");
const { resolveUploadFile } = require("./fileCleanup");
const { embedPixels, modelVersion } = require("./placeModel");
const {
    INPUT_SIZE,
    MAX_EMPTY_FRACTION,
    RESIZE_SHORT_EDGE,
    rankScenes,
    renderView,
    viewYaws,
} = require("./placeRecognition");

// Rendering samples the panorama per output pixel, so its size barely affects
// speed, but decoding a 16k-wide panorama to raw pixels would need ~400 MB.
// Both sides are capped, so a tall or oddly shaped upload stays small too.
const MAX_PANORAMA_WIDTH = 4096;
const MAX_PANORAMA_HEIGHT = 2048;
const MAX_INPUT_PIXELS = 1_000_000_000; // same ceiling as the upload pipeline

/** Local file for a scene image, or null for anything outside this app's uploads. */
function localFileFor(image) {
    let pathname = image;
    try {
        if (/^https?:\/\//i.test(image)) pathname = new URL(image).pathname;
    } catch {
        return null;
    }
    const match = /^\/?uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(pathname || "");
    if (!match) return null;
    try {
        return resolveUploadFile(match[1]);
    } catch {
        return null;
    }
}

function toBuffer(vector) {
    return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function fromBuffer(stored) {
    // `.lean()` hands back the driver's Binary wrapper, not a Node Buffer; its
    // bytes are in `.buffer` up to `.position`. Reading `.length` off a Binary
    // silently yields an empty vector and NaN similarities.
    let bytes = stored;
    if (!(bytes instanceof Uint8Array) && bytes?.buffer instanceof Uint8Array) {
        bytes = bytes.buffer.subarray(0, typeof bytes.position === "number" ? bytes.position : bytes.buffer.length);
    }
    if (!(bytes instanceof Uint8Array) || bytes.length % 4 !== 0) throw new Error("Stored place descriptor is unreadable.");
    // Copy into an aligned buffer: stored bytes can sit at any offset.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Float32Array(copy.buffer);
}

/** Embeds a scene's panorama as a ring of views and stores the result. */
async function indexScene(scene) {
    const file = localFileFor(scene.image);
    if (!file) return { sceneId: String(scene._id), indexed: false, reason: "image is not an uploaded file" };

    const { data, info } = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
        .resize({ width: MAX_PANORAMA_WIDTH, height: MAX_PANORAMA_HEIGHT, fit: "inside", withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const views = [];
    let skippedViews = 0;
    for (const yawDeg of viewYaws()) {
        const { pixels, emptyFraction } = renderView(data, info.width, info.height, { yawDeg });
        if (emptyFraction > MAX_EMPTY_FRACTION) {
            skippedViews += 1;
            continue;
        }
        views.push({ yawDeg, vector: toBuffer(await embedPixels(pixels)) });
    }

    await SceneEmbedding.findOneAndUpdate(
        { sceneId: scene._id },
        { sceneId: scene._id, projectId: scene.projectId, image: scene.image, modelVersion: modelVersion(), views, skippedViews, builtAt: new Date() },
        { upsert: true, setDefaultsOnInsert: true },
    );
    return { sceneId: String(scene._id), indexed: true, views: views.length, skippedViews };
}

// One indexing run per project at a time, shared by concurrent requests.
const inFlight = new Map();

/**
 * Brings a project's index up to date and returns it.
 * @returns {Promise<{ index: object[], built: number, skipped: object[] }>}
 */
function ensureProjectIndex(projectId) {
    const key = String(projectId);
    if (!inFlight.has(key)) {
        const run = (async () => {
            const scenes = await Scene.find({ projectId, image: { $nin: ["", null] } }).select("_id projectId name image").lean();
            const existing = await SceneEmbedding.find({ projectId }).lean();
            const bySceneId = new Map(existing.map((entry) => [String(entry.sceneId), entry]));
            const version = modelVersion();

            let built = 0;
            const skipped = [];
            for (const scene of scenes) {
                const current = bySceneId.get(String(scene._id));
                if (current && current.image === scene.image && current.modelVersion === version) continue;
                try {
                    const result = await indexScene(scene);
                    if (result.indexed) built += 1;
                    else skipped.push({ sceneId: result.sceneId, name: scene.name, reason: result.reason });
                } catch (error) {
                    skipped.push({ sceneId: String(scene._id), name: scene.name, reason: error.message });
                }
            }

            // Drop entries for scenes that were deleted or lost their image.
            const liveIds = scenes.map((scene) => scene._id);
            await SceneEmbedding.deleteMany({ projectId, sceneId: { $nin: liveIds } });

            const fresh = await SceneEmbedding.find({ projectId, modelVersion: version }).lean();
            const index = fresh.map((entry) => ({
                sceneId: String(entry.sceneId),
                views: entry.views.map((view) => ({ yawDeg: view.yawDeg, vector: fromBuffer(view.vector) })),
            }));
            return { index, built, skipped, sceneCount: scenes.length };
        })().finally(() => inFlight.delete(key));
        inFlight.set(key, run);
    }
    return inFlight.get(key);
}

/**
 * Prepares a visitor's photo exactly as DINOv2 expects: honour EXIF rotation,
 * shortest edge to 256, centre crop to 224.
 */
async function photoPixels(buffer) {
    const { data } = await sharp(buffer)
        .rotate()
        .resize({ width: RESIZE_SHORT_EDGE, height: RESIZE_SHORT_EDGE, fit: "outside", kernel: "cubic" })
        .resize(INPUT_SIZE, INPUT_SIZE, { fit: "cover", position: "centre" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return data;
}

/**
 * Locates a photo within a project.
 * @param {string} projectId
 * @param {Buffer} photo - the uploaded image bytes
 */
async function locateInProject(projectId, photo) {
    const [{ index, built, skipped, sceneCount }, pixels] = await Promise.all([
        ensureProjectIndex(projectId),
        photoPixels(photo),
    ]);
    const query = await embedPixels(pixels);
    // Descriptors of another length came from a different model; comparing
    // them would produce meaningless scores, so they are left out.
    const comparable = index.filter((entry) => entry.views.every((view) => view.vector.length === query.length));
    return { matches: rankScenes(query, comparable), indexedScenes: comparable.length, sceneCount, newlyIndexed: built, skipped };
}

module.exports = { indexScene, ensureProjectIndex, locateInProject, localFileFor };
