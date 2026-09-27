/**
 * Loads the YOLOX-S object detector used to tag scenes.
 *
 * Weights (36 MB) are downloaded once from the official YOLOX release,
 * verified against a SHA-256, and cached in backend/.cache/models. Set
 * OBJECT_MODEL_PATH to use a copy you provide instead.
 *
 * Model: YOLOX-S (Ge et al., 2021), COCO-trained, Apache-2.0,
 * github.com/Megvii-BaseDetection/YOLOX release 0.1.1rc0.
 *
 * Runs on a GPU through DirectML when that is faster (see onnxDevice.js).
 * Measured on an RTX 3050 laptop GPU: 15 ms per view, against 68 ms on the
 * CPU, with identical outputs.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { chooseDevice, forgetDevice, sessionOptions, describeDevice } = require("./onnxDevice");

const MODEL_VERSION = "yolox-s@0.1.1rc0";
const MODEL_URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx";
const MODEL_SHA256 = "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063";
const INPUT_SIZE = 640; // fixed by the exported graph
const CACHE_PATH = path.join(__dirname, "..", ".cache", "models", "yolox-s.onnx");

let sessionPromise = null;
let testDetector = null;
let activeDevice = null;

async function sha256Of(file) {
    const hash = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
        fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
    });
    return hash.digest("hex");
}

/** Path to verified weights, downloading them if needed. Never uses a partial or altered file. */
async function ensureModelFile() {
    if (process.env.OBJECT_MODEL_PATH) return process.env.OBJECT_MODEL_PATH;
    if (fs.existsSync(CACHE_PATH) && await sha256Of(CACHE_PATH) === MODEL_SHA256) return CACHE_PATH;

    await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Could not download the object-detection model (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== MODEL_SHA256) {
        throw new Error("The downloaded object-detection model failed its checksum and was discarded.");
    }
    const temporary = `${CACHE_PATH}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, bytes);
    await fsp.rename(temporary, CACHE_PATH);
    return CACHE_PATH;
}

const deviceSpec = (file) => ({ key: `${MODEL_VERSION}|${MODEL_SHA256.slice(0, 12)}`, file, inputName: "images", inputShape: [1, 3, INPUT_SIZE, INPUT_SIZE] });

/** Where the detector runs on this machine, choosing (and timing) it on first call. */
async function prepareDevice() {
    return chooseDevice(deviceSpec(await ensureModelFile()));
}

function loadSession() {
    if (!sessionPromise) {
        sessionPromise = (async () => {
            const ort = require("onnxruntime-node");
            const file = await ensureModelFile();
            const { device, options } = await chooseDevice(deviceSpec(file));
            let session;
            try {
                session = await ort.InferenceSession.create(file, { graphOptimizationLevel: "all", ...options });
                activeDevice = device;
            } catch (error) {
                if (device === "cpu") throw error;
                // A remembered GPU that no longer loads (new driver, different
                // machine): run on the CPU and choose again next time.
                await forgetDevice(deviceSpec(file));
                session = await ort.InferenceSession.create(file, { graphOptimizationLevel: "all", ...sessionOptions("cpu") });
                activeDevice = "cpu";
            }
            return { ort, session };
        })().catch((error) => {
            sessionPromise = null;
            // Reported as "unavailable" rather than as a server fault: the usual
            // cause is a machine that cannot reach GitHub to download the model.
            const unavailable = new Error("Object detection is not available: its model could not be loaded. Run `npm run models:fetch` in the backend.");
            unavailable.status = 503;
            unavailable.cause = error;
            throw unavailable;
        });
    }
    return sessionPromise;
}

/**
 * Runs the detector on one INPUT_SIZE x INPUT_SIZE planar BGR input.
 * @param {Float32Array} input - from objectDetection.toModelInput
 * @returns {Promise<Float32Array>} raw YOLOX output (anchors x 85)
 */
async function runDetector(input) {
    if (testDetector) return testDetector(input);
    const { ort, session } = await loadSession();
    const output = await session.run({ images: new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]) });
    return output.output.data;
}

/** Replaces the model in tests, so the pipeline is exercised without a 36 MB download. */
function setDetectorForTests(detector) {
    testDetector = detector;
}

function modelVersion() {
    return testDetector ? "test-detector" : MODEL_VERSION;
}

/** "CPU" or "GPU (DirectML adapter N)" once the model has loaded, else null. */
function detectorDevice() {
    return activeDevice === null ? null : describeDevice(activeDevice);
}

module.exports = { runDetector, ensureModelFile, prepareDevice, detectorDevice, setDetectorForTests, modelVersion, INPUT_SIZE, MODEL_SHA256 };
