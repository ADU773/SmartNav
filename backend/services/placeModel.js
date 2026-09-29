/**
 * Loads the DINOv2-small image encoder used for visual place recognition and
 * turns pixels into descriptors.
 *
 * The weights (24 MB, int8) are not committed. They are downloaded once from
 * a pinned Hugging Face revision, verified against a SHA-256, and cached
 * (see modelStore.js). Set PLACE_MODEL_PATH to use a copy you provide
 * instead, for example on a machine without internet access.
 *
 * Model: DINOv2 ViT-S/14 (Oquab et al., 2023), Apache-2.0, via the ONNX export
 * at huggingface.co/Xenova/dinov2-small.
 */

const { defineModel } = require("./modelStore");
const { descriptorFromHidden, toModelInput, INPUT_SIZE } = require("./placeRecognition");

const MODEL_VERSION = "dinov2-small-int8@c2bb04a";
const MODEL_SHA256 = "3afdc8bc63b50558d6e5770f5b799bb82455c2311183a2de43803f343a29d917";

const model = defineModel({
    id: "place",
    label: "Place recognition (DINOv2-small)",
    version: MODEL_VERSION,
    licence: "Apache-2.0",
    files: {
        model: {
            name: "dinov2-small-int8.onnx",
            url: "https://huggingface.co/Xenova/dinov2-small/resolve/c2bb04a51fab207c420665f1946016107bffc701/onnx/model_quantized.onnx",
            sha256: MODEL_SHA256,
            envPath: "PLACE_MODEL_PATH",
        },
    },
    // CPU only, on purpose: this int8 model crashes the whole process under
    // DirectML (measured), and takes about 20 ms per view on the CPU anyway.
    gpu: false,
});

let testEmbedder = null;

/**
 * Returns a path to verified model weights, downloading them if needed.
 * A partial or tampered download is never used.
 */
async function ensureModelFile() {
    return (await model.ensureFiles()).model;
}

/** One ONNX session per process, created on first use. A failure is not cached. */
function loadSession() {
    return model.session();
}

/**
 * Embeds one INPUT_SIZE x INPUT_SIZE RGB image.
 * @param {Uint8Array} pixels
 * @returns {Promise<Float32Array>} unit-length descriptor
 */
async function embedPixels(pixels) {
    if (testEmbedder) return testEmbedder(pixels);
    const output = await model.run((ort) => ({ pixel_values: new ort.Tensor("float32", toModelInput(pixels), [1, 3, INPUT_SIZE, INPUT_SIZE]) }));
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
