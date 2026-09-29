/**
 * Loads the YOLOX-S object detector used to tag scenes.
 *
 * Weights (36 MB) are downloaded once from the official YOLOX release,
 * verified against a SHA-256, and cached (see modelStore.js). Set
 * OBJECT_MODEL_PATH to use a copy you provide instead.
 *
 * Model: YOLOX-S (Ge et al., 2021), COCO-trained, Apache-2.0,
 * github.com/Megvii-BaseDetection/YOLOX release 0.1.1rc0.
 *
 * Runs on a GPU through DirectML when that is faster (see onnxDevice.js).
 * Measured on an RTX 3050 laptop GPU: 15 ms per view, against 68 ms on the
 * CPU, with identical outputs.
 */

const { defineModel } = require("./modelStore");

const MODEL_VERSION = "yolox-s@0.1.1rc0";
const MODEL_SHA256 = "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063";
const INPUT_SIZE = 640; // fixed by the exported graph

const model = defineModel({
    id: "objects",
    label: "Object detection (YOLOX-S)",
    version: MODEL_VERSION,
    licence: "Apache-2.0",
    files: {
        model: {
            name: "yolox-s.onnx",
            url: "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx",
            sha256: MODEL_SHA256,
            envPath: "OBJECT_MODEL_PATH",
        },
    },
    gpu: { inputName: "images", inputShape: [1, 3, INPUT_SIZE, INPUT_SIZE] },
});

let testDetector = null;

/** Path to verified weights, downloading them if needed. Never uses a partial or altered file. */
async function ensureModelFile() {
    return (await model.ensureFiles()).model;
}

/** Where the detector runs on this machine, choosing (and timing) it on first call. */
function prepareDevice() {
    return model.prepareDevice();
}

/**
 * Runs the detector on one INPUT_SIZE x INPUT_SIZE planar BGR input.
 * @param {Float32Array} input - from objectDetection.toModelInput
 * @returns {Promise<Float32Array>} raw YOLOX output (anchors x 85)
 */
async function runDetector(input) {
    if (testDetector) return testDetector(input);
    const output = await model.run((ort) => ({ images: new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]) }));
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
    return model.device();
}

module.exports = { runDetector, ensureModelFile, prepareDevice, detectorDevice, setDetectorForTests, modelVersion, INPUT_SIZE, MODEL_SHA256 };
