/**
 * Detects the objects in a scene's panorama.
 */

const sharp = require("sharp");
const { renderView } = require("./placeRecognition");
const { localFileFor } = require("./placeIndex");
const { runDetector, INPUT_SIZE, modelVersion } = require("./objectModel");
const {
    DETECT_MAX_EMPTY_FRACTION,
    decodeOutput,
    detectionViews,
    detectionsFromView,
    mergeDetections,
    nonMaxSuppression,
    summarize,
    toModelInput,
} = require("./objectDetection");

// Decoding a very large panorama to raw pixels costs memory, not accuracy:
// every view is rendered at the model's 640px input anyway. Both sides are
// capped, so a tall or oddly shaped upload cannot decode to gigabytes.
const MAX_PANORAMA_WIDTH = 4096;
const MAX_PANORAMA_HEIGHT = 2048;
const MAX_INPUT_PIXELS = 1_000_000_000; // same ceiling as the upload pipeline

// A scan keeps a CPU core busy for a second or more, so scans run one at a
// time, with a short queue. Beyond that the server reports that it is busy
// rather than letting work pile up behind every other request.
const MAX_WAITING_SCANS = 3;
let queue = Promise.resolve();
let waiting = 0;

function withStatus(error, status, message) {
    const wrapped = new Error(message);
    wrapped.status = status;
    wrapped.cause = error;
    return wrapped;
}

function runExclusive(work) {
    if (waiting >= MAX_WAITING_SCANS) {
        return Promise.reject(withStatus(null, 503, "The server is busy scanning other scenes. Try again in a moment."));
    }
    waiting += 1;
    const run = queue.then(() => {
        waiting -= 1;
        return work();
    });
    queue = run.catch(() => {});
    return run;
}

async function scan(file) {
    let decoded;
    try {
        decoded = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
            .resize({ width: MAX_PANORAMA_WIDTH, height: MAX_PANORAMA_HEIGHT, fit: "inside", withoutEnlargement: true })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
    } catch (error) {
        throw withStatus(error, 422, "This scene's image could not be read. Upload it again and retry.");
    }
    const { data, info } = decoded;

    const found = [];
    let viewsScanned = 0;
    for (const [index, view] of detectionViews().entries()) {
        const { pixels, emptyFraction } = renderView(data, info.width, info.height, { ...view, size: INPUT_SIZE });
        if (emptyFraction > DETECT_MAX_EMPTY_FRACTION) continue;
        viewsScanned += 1;
        const output = await runDetector(toModelInput(pixels, INPUT_SIZE));
        const boxes = nonMaxSuppression(decodeOutput(output, INPUT_SIZE));
        found.push(...detectionsFromView(boxes, INPUT_SIZE, view, index));
    }

    const detections = mergeDetections(found);
    return { detections, labels: summarize(detections), viewsScanned, modelVersion: modelVersion() };
}

// Two requests for the same scene and image share one scan.
const inFlight = new Map();

/**
 * Runs detection over a scene's panorama.
 * @param {{ _id: unknown, image: string }} scene
 * @returns {Promise<{ detections: object[], labels: object[], viewsScanned: number, modelVersion: string }>}
 */
function detectObjectsInScene(scene) {
    const file = localFileFor(scene.image);
    if (!file) {
        return Promise.reject(withStatus(null, 400, "This scene's image is not an uploaded file, so it cannot be scanned."));
    }
    const key = `${scene._id}:${scene.image}`;
    if (!inFlight.has(key)) {
        const run = runExclusive(() => scan(file)).finally(() => inFlight.delete(key));
        inFlight.set(key, run);
    }
    return inFlight.get(key);
}

module.exports = { detectObjectsInScene };
