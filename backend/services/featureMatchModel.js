/**
 * Loads SuperPoint + LightGlue, the GPU-class feature matcher used to register
 * panorama frames.
 *
 * SuperPoint finds keypoints and LightGlue (Lindenberger et al., ICCV 2023;
 * Apache-2.0) matches them with attention. The two are exported as one ONNX
 * graph by github.com/fabio-sim/LightGlue-ONNX (release v2.0): two grayscale
 * images in, keypoints and matched index pairs out. Weights (51 MB) are
 * downloaded once, verified against a SHA-256, and cached in
 * backend/.cache/models. Set MATCH_MODEL_PATH to use a copy you provide.
 *
 * Licence note: the SuperPoint weights come from Magic Leap's SuperPointPretrainedNetwork,
 * which is released for non-commercial research use. Check that fits your
 * deployment before shipping this commercially.
 *
 * Runs on a GPU through DirectML when that is faster (see onnxDevice.js).
 * Measured on an RTX 3050 laptop GPU: about 190 ms per 1024x768 pair, against
 * about 700 ms on the CPU, with identical matches.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { chooseDevice, forgetDevice, sessionOptions, describeDevice } = require("./onnxDevice");

const MODEL_VERSION = "superpoint-lightglue@v2.0";
const MODEL_URL = "https://github.com/fabio-sim/LightGlue-ONNX/releases/download/v2.0/superpoint_lightglue_pipeline.onnx";
const MODEL_SHA256 = "228994cea8c010146fa2aef933baa3ffaa4bcdc522bc8aa560087fcff8134526";
const CACHE_PATH = path.join(__dirname, "..", ".cache", "models", "superpoint-lightglue.onnx");
/** Frames are matched at this long edge; the graph is fixed at 1024 keypoints. */
const MODEL_EDGE = 1024;
const KEYPOINTS = 1024; // fixed by the exported graph

let sessionPromise = null;
let testMatcher = null;
let activeDevice = null;
let queue = Promise.resolve();

async function sha256Of(file) {
    const hash = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
        fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
    });
    return hash.digest("hex");
}

/** Path to verified weights, downloading them if needed. Never uses a partial or altered file. */
async function ensureModelFile() {
    if (process.env.MATCH_MODEL_PATH) return process.env.MATCH_MODEL_PATH;
    if (fs.existsSync(CACHE_PATH) && await sha256Of(CACHE_PATH) === MODEL_SHA256) return CACHE_PATH;

    await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Could not download the feature-matching model (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== MODEL_SHA256) {
        throw new Error("The downloaded feature-matching model failed its checksum and was discarded.");
    }
    const temporary = `${CACHE_PATH}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, bytes);
    await fsp.rename(temporary, CACHE_PATH);
    return CACHE_PATH;
}

const deviceSpec = (file) => ({
    key: `${MODEL_VERSION}|${MODEL_SHA256.slice(0, 12)}`,
    file,
    inputName: "images",
    inputShape: [2, 1, 768, MODEL_EDGE],
});

/** Where the matcher runs on this machine, choosing (and timing) it on first call. */
async function prepareDevice() {
    return chooseDevice(deviceSpec(await ensureModelFile()));
}

// Warnings about shape ops falling back to the CPU are expected under DirectML
// and would otherwise print on every model load.
const QUIET = { logSeverityLevel: 3 };

function loadSession() {
    if (!sessionPromise) {
        sessionPromise = (async () => {
            const ort = require("onnxruntime-node");
            const file = await ensureModelFile();
            const { device, options } = await chooseDevice(deviceSpec(file));
            let session;
            try {
                session = await ort.InferenceSession.create(file, { graphOptimizationLevel: "all", ...QUIET, ...options });
                activeDevice = device;
            } catch (error) {
                if (device === "cpu") throw error;
                // A remembered GPU that no longer loads (new driver, different
                // machine): run on the CPU and choose again next time.
                await forgetDevice(deviceSpec(file));
                session = await ort.InferenceSession.create(file, { graphOptimizationLevel: "all", ...QUIET, ...sessionOptions("cpu") });
                activeDevice = "cpu";
            }
            return { ort, session };
        })().catch((error) => {
            sessionPromise = null;
            // Reported as "unavailable" rather than as a server fault: the usual
            // cause is a machine that cannot reach GitHub to download the model.
            const unavailable = new Error("GPU feature matching is not available: its model could not be loaded. Run `npm run models:fetch` in the backend.");
            unavailable.status = 503;
            unavailable.cause = error;
            throw unavailable;
        });
    }
    return sessionPromise;
}

/**
 * Matches two same-sized grayscale images.
 *
 * Runs one at a time: a GPU is one shared resource, and concurrent runs on the
 * same DirectML session are not worth the risk for a request that already
 * takes a fraction of a second.
 *
 * @param {Float32Array} pixels - both images, planar, values 0-1 (2 x height x width)
 * @returns {Promise<{ pointsA: number[], pointsB: number[], matches: { from: number, to: number, score: number }[] }>}
 *   keypoints of A and B as flat [x, y, x, y ...] arrays in the model's pixel
 *   space, and index pairs into them
 */
function matchImages(pixels, width, height) {
    const run = async () => {
        if (testMatcher) return testMatcher(pixels, width, height);
        const { ort, session } = await loadSession();
        const outputs = await session.run({ images: new ort.Tensor("float32", pixels, [2, 1, height, width]) });
        const keypoints = outputs.keypoints.data;
        const rows = outputs.matches.data;
        const scores = outputs.mscores.data;
        const half = KEYPOINTS * 2;
        const matches = [];
        for (let r = 0; r < scores.length; r += 1) {
            matches.push({ from: Number(rows[r * 3 + 1]), to: Number(rows[r * 3 + 2]), score: scores[r] });
        }
        return {
            pointsA: Array.from(keypoints.subarray(0, half), Number),
            pointsB: Array.from(keypoints.subarray(half, half * 2), Number),
            matches,
        };
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
}

/** Replaces the model in tests, so the pipeline is exercised without a 51 MB download. */
function setMatcherForTests(matcher) {
    testMatcher = matcher;
}

function modelVersion() {
    return testMatcher ? "test-matcher" : MODEL_VERSION;
}

/** "CPU" or "GPU (DirectML adapter N)" once the model has loaded, else null. */
function matcherDevice() {
    return activeDevice === null ? null : describeDevice(activeDevice);
}

module.exports = { matchImages, ensureModelFile, prepareDevice, matcherDevice, setMatcherForTests, modelVersion, MODEL_EDGE, MODEL_SHA256 };
