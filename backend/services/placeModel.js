/**
 * Loads the DINOv2-small image encoder used for visual place recognition and
 * turns pixels into descriptors.
 *
 * The weights (24 MB, int8) are not committed. They are downloaded once from
 * a pinned Hugging Face revision, verified against a SHA-256, and cached in
 * backend/.cache/models. Set PLACE_MODEL_PATH to use a copy you provide
 * instead, for example on a machine without internet access.
 *
 * Model: DINOv2 ViT-S/14 (Oquab et al., 2023), Apache-2.0, via the ONNX export
 * at huggingface.co/Xenova/dinov2-small.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { descriptorFromHidden, toModelInput, INPUT_SIZE } = require("./placeRecognition");

const MODEL_VERSION = "dinov2-small-int8@c2bb04a";
const MODEL_URL = "https://huggingface.co/Xenova/dinov2-small/resolve/c2bb04a51fab207c420665f1946016107bffc701/onnx/model_quantized.onnx";
const MODEL_SHA256 = "3afdc8bc63b50558d6e5770f5b799bb82455c2311183a2de43803f343a29d917";
const CACHE_PATH = path.join(__dirname, "..", ".cache", "models", "dinov2-small-int8.onnx");

let sessionPromise = null;
let testEmbedder = null;

async function sha256Of(file) {
    const hash = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
        fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
    });
    return hash.digest("hex");
}

/**
 * Returns a path to verified model weights, downloading them if needed.
 * A partial or tampered download is never used: the file is written under a
 * temporary name and only moved into place once its checksum matches.
 */
async function ensureModelFile() {
    if (process.env.PLACE_MODEL_PATH) return process.env.PLACE_MODEL_PATH;
    if (fs.existsSync(CACHE_PATH) && await sha256Of(CACHE_PATH) === MODEL_SHA256) return CACHE_PATH;

    await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Could not download the place-recognition model (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== MODEL_SHA256) throw new Error("The downloaded place-recognition model failed its checksum and was discarded.");

    const temporary = `${CACHE_PATH}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, bytes);
    await fsp.rename(temporary, CACHE_PATH);
    return CACHE_PATH;
}

/** One ONNX session per process, created on first use. A failure is not cached. */
function loadSession() {
    if (!sessionPromise) {
        sessionPromise = (async () => {
            const ort = require("onnxruntime-node");
            const file = await ensureModelFile();
            const session = await ort.InferenceSession.create(file, { graphOptimizationLevel: "all" });
            return { ort, session };
        })().catch((error) => {
            sessionPromise = null;
            throw error;
        });
    }
    return sessionPromise;
}

/**
 * Embeds one INPUT_SIZE x INPUT_SIZE RGB image.
 * @param {Uint8Array} pixels
 * @returns {Promise<Float32Array>} unit-length descriptor
 */
async function embedPixels(pixels) {
    if (testEmbedder) return testEmbedder(pixels);
    const { ort, session } = await loadSession();
    const input = new ort.Tensor("float32", toModelInput(pixels), [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const output = await session.run({ pixel_values: input });
    const hidden = output.last_hidden_state;
    return descriptorFromHidden(hidden.data, hidden.dims[1], hidden.dims[2]);
}

/**
 * Replaces the model with a deterministic function in tests, so the route,
 * ownership and indexing pipeline can be exercised without a 24 MB download.
 * @param {((pixels: Uint8Array) => Float32Array) | null} embedder
 */
function setEmbedderForTests(embedder) {
    testEmbedder = embedder;
}

function modelVersion() {
    return testEmbedder ? "test-embedder" : MODEL_VERSION;
}

module.exports = { embedPixels, ensureModelFile, loadSession, setEmbedderForTests, modelVersion, MODEL_VERSION, MODEL_SHA256 };
