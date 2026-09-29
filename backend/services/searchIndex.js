/**
 * Builds and queries the per-project text-search index (CLIP).
 *
 * Like the place-recognition index it is lazy and incremental: a scene is
 * (re)indexed only when it has no entry yet, its image changed, or the model
 * or view layout changed. Unlike it, indexing runs as a background job. A
 * search answers at once from the scenes already indexed and says how many
 * are still pending, so the first search in a large tour is never a
 * minute-long request; the index fills in behind it, a scene at a time.
 */

const sharp = require("sharp");
const Scene = require("../models/Scene");
const SceneSearchEmbedding = require("../models/SceneSearchEmbedding");
const { defineJob, enqueue } = require("./jobs");
const { localFileFor, toBuffer, fromBuffer } = require("./placeIndex");
const { renderView, MAX_EMPTY_FRACTION } = require("./placeRecognition");
const { embedImages, embedText, modelVersion, INPUT_SIZE } = require("./ml/clipModel");
const {
    SEARCH_FOV_DEG,
    SEARCH_STEP_DEG,
    SEARCH_PANORAMA_WIDTH,
    rankScenesByText,
    searchYaws,
} = require("./sceneSearch");

const MAX_INPUT_PIXELS = 1_000_000_000; // same ceiling as the upload pipeline
const INDEX_JOB = "search-index";
const WITH_IMAGE = { $nin: ["", null] };

/** What an index entry must have been built with to be used: model and view layout. */
function indexVersion() {
    return `${modelVersion()}|fov${SEARCH_FOV_DEG}-step${SEARCH_STEP_DEG}-w${SEARCH_PANORAMA_WIDTH}`;
}

/** A problem with the scene's image itself, recorded so it is not retried until the image changes. */
function unsearchable(reason) {
    const error = new Error(reason);
    error.unsearchable = true;
    return error;
}

async function decodePanorama(file) {
    let decoded;
    try {
        decoded = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
            .resize({ width: SEARCH_PANORAMA_WIDTH, height: SEARCH_PANORAMA_WIDTH / 2, fit: "inside", withoutEnlargement: true })
            // Greyscale and CMYK files decode to 1 or 4 channels; views are
            // rendered from 3.
            .toColourspace("srgb")
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
    } catch {
        throw unsearchable("The image could not be read.");
    }
    if (decoded.info.channels !== 3) throw unsearchable("The image could not be read.");
    return { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
}

/**
 * Embeds one scene's panorama as a ring of views and stores the result, but
 * only if the scene still shows that image when the work is done.
 * @returns {Promise<{ sceneId: string, indexed: boolean, reason?: string }>}
 */
async function indexScene(scene) {
    const version = indexVersion();
    const sceneId = String(scene._id);
    let views = [];
    let skippedViews = 0;
    let reason = null;
    try {
        const file = localFileFor(scene.image);
        if (!file) throw unsearchable("The image is not an uploaded file.");
        const { data, width, height } = await decodePanorama(file);
        const kept = [];
        for (const yawDeg of searchYaws()) {
            const { pixels, emptyFraction } = renderView(data, width, height, { yawDeg, fovDeg: SEARCH_FOV_DEG, size: INPUT_SIZE });
            if (emptyFraction > MAX_EMPTY_FRACTION) skippedViews += 1;
            else kept.push({ yawDeg, pixels });
        }
        if (!kept.length) throw unsearchable("The panorama is almost entirely blank.");
        const vectors = await embedImages(kept.map((view) => view.pixels));
        views = kept.map((view, i) => ({ yawDeg: view.yawDeg, vector: toBuffer(vectors[i]) }));
    } catch (error) {
        if (!error.unsearchable) throw error;
        reason = error.message;
    }

    // An image replaced mid-run is left for the next run to index; storing
    // this one would only be discarded as stale.
    if (!await Scene.exists({ _id: scene._id, image: scene.image })) return { sceneId, indexed: false };
    await SceneSearchEmbedding.findOneAndUpdate(
        { sceneId: scene._id },
        { sceneId: scene._id, projectId: scene.projectId, image: scene.image, modelVersion: version, views, skippedViews, unsearchable: reason, builtAt: new Date() },
        { upsert: true, setDefaultsOnInsert: true },
    );
    return reason ? { sceneId, indexed: false, reason } : { sceneId, indexed: true };
}

/** Index entries that match each scene's current image and the current model. */
async function currentEntries(scenes, version) {
    const images = new Map(scenes.map((scene) => [String(scene._id), scene.image]));
    const entries = await SceneSearchEmbedding.find({ sceneId: { $in: scenes.map((scene) => scene._id) }, modelVersion: version }).lean();
    return entries.filter((entry) => images.get(String(entry.sceneId)) === entry.image);
}

/**
 * Brings a project's search index up to date. Runs as the "search-index" job.
 * @param {string} projectId
 * @param {{ progress?: (percent: number, detail?: string) => void }} [options]
 */
async function buildSearchIndex(projectId, { progress = () => {} } = {}) {
    const version = indexVersion();
    const scenes = await Scene.find({ projectId, image: WITH_IMAGE }).select("_id projectId name image").lean();
    const done = new Set((await currentEntries(scenes, version)).map((entry) => String(entry.sceneId)));
    const pending = scenes.filter((scene) => !done.has(String(scene._id)));

    let built = 0;
    const skipped = [];
    for (const [i, scene] of pending.entries()) {
        progress((i / pending.length) * 100, `Indexing ${scene.name} (${i + 1} of ${pending.length})`);
        try {
            const result = await indexScene(scene);
            if (result.indexed) built += 1;
            else if (result.reason) skipped.push({ sceneId: result.sceneId, name: scene.name, reason: result.reason });
        } catch (error) {
            // A missing model fails every scene the same way (and would retry
            // its download for each), so it ends the run. Anything else is
            // reported and retried next time.
            if (error.status === 503) throw error;
            skipped.push({ sceneId: String(scene._id), name: scene.name, reason: error.message });
        }
    }

    // Drop entries for scenes that were deleted or lost their image.
    await SceneSearchEmbedding.deleteMany({ projectId, sceneId: { $nin: scenes.map((scene) => scene._id) } });
    return { sceneCount: scenes.length, built, skipped };
}

// One project is indexed at a time across the server: each scene keeps a CPU
// core busy for about half a second.
defineJob(INDEX_JOB, ({ projectId }, { progress }) => buildSearchIndex(projectId, { progress }), {
    concurrency: 1,
    maxWaiting: 20,
    timeoutMs: 30 * 60 * 1000,
});

/** Queues indexing for a project; a second request while it waits or runs shares the job. */
function startIndexing(projectId, ownerId) {
    try {
        const job = enqueue(INDEX_JOB, { projectId: String(projectId) }, { ownerId, dedupeKey: `${INDEX_JOB}:${projectId}` });
        return { status: job.status, jobId: job.id };
    } catch (error) {
        // A full queue is reported, not raised: the search itself succeeded.
        if (error.status === 503) return { status: "busy", jobId: null };
        throw error;
    }
}

/**
 * Searches a project's scenes for a text description.
 *
 * Scenes not yet indexed (new, or with a changed image) are left out of this
 * answer and queued for indexing; the reply says how many are pending.
 *
 * @param {string} projectId
 * @param {string} text
 * @param {{ limit?: number, ownerId?: string|null }} [options] - `ownerId` owns the indexing job
 */
async function searchProject(projectId, text, { limit = 5, ownerId = null } = {}) {
    // Embedding first means a missing model fails the request (503) before
    // any indexing is queued behind it.
    const query = await embedText(text);
    const version = indexVersion();
    const scenes = await Scene.find({ projectId, image: WITH_IMAGE }).select("_id name image").lean();
    const byId = new Map(scenes.map((scene) => [String(scene._id), scene]));

    const current = await currentEntries(scenes, version);
    const pendingScenes = scenes.length - current.length;
    const index = [];
    const unsearchableScenes = [];
    for (const entry of current) {
        const scene = byId.get(String(entry.sceneId));
        if (!entry.views.length) {
            unsearchableScenes.push({ sceneId: String(scene._id), name: scene.name, reason: entry.unsearchable });
            continue;
        }
        const views = entry.views.map((view) => ({ yawDeg: view.yawDeg, vector: fromBuffer(view.vector) }));
        // Vectors of another length came from a different model; comparing
        // them would produce meaningless scores.
        if (views.every((view) => view.vector.length === query.length)) index.push({ sceneId: String(scene._id), views });
    }

    const matches = rankScenesByText(query, index).slice(0, limit).map((match) => ({
        ...match,
        name: byId.get(match.sceneId).name,
        image: byId.get(match.sceneId).image,
    }));
    return {
        matches,
        sceneCount: scenes.length,
        indexedScenes: index.length,
        pendingScenes,
        unsearchable: unsearchableScenes,
        indexing: pendingScenes > 0 ? startIndexing(projectId, ownerId) : null,
    };
}

module.exports = { buildSearchIndex, indexScene, searchProject, indexVersion, INDEX_JOB };
