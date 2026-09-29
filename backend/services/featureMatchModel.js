/**
 * Loads SuperPoint + LightGlue, the GPU-class feature matcher used to register
 * panorama frames.
 *
 * SuperPoint finds keypoints and LightGlue (Lindenberger et al., ICCV 2023;
 * Apache-2.0) matches them with attention. The two are exported as one ONNX
 * graph by github.com/fabio-sim/LightGlue-ONNX (release v2.0): two grayscale
 * images in, keypoints and matched index pairs out. Weights (51 MB) are
 * downloaded once, verified against a SHA-256, and cached (see modelStore.js).
 * Set MATCH_MODEL_PATH to use a copy you provide.
 *
 * Licence note: the SuperPoint weights come from Magic Leap's SuperPointPretrainedNetwork,
 * which is released for non-commercial research use. Check that fits your
 * deployment before shipping this commercially.
 *
 * Runs on a GPU through DirectML when that is faster (see onnxDevice.js).
 * Measured on an RTX 3050 laptop GPU: about 190 ms per 1024x768 pair, against
 * about 700 ms on the CPU, with identical matches.
 */

const { defineModel } = require("./modelStore");

const MODEL_VERSION = "superpoint-lightglue@v2.0";
const MODEL_SHA256 = "228994cea8c010146fa2aef933baa3ffaa4bcdc522bc8aa560087fcff8134526";
/** Frames are matched at this long edge; the graph is fixed at 1024 keypoints. */
const MODEL_EDGE = 1024;
const KEYPOINTS = 1024; // fixed by the exported graph

const model = defineModel({
    id: "matching",
    label: "Panorama feature matching (SuperPoint + LightGlue)",
    version: MODEL_VERSION,
    licence: "LightGlue Apache-2.0; SuperPoint weights non-commercial research use",
    files: {
        model: {
            name: "superpoint-lightglue.onnx",
            url: "https://github.com/fabio-sim/LightGlue-ONNX/releases/download/v2.0/superpoint_lightglue_pipeline.onnx",
            sha256: MODEL_SHA256,
            envPath: "MATCH_MODEL_PATH",
        },
    },
    gpu: { inputName: "images", inputShape: [2, 1, 768, MODEL_EDGE] },
});

let testMatcher = null;
let queue = Promise.resolve();

/** Path to verified weights, downloading them if needed. Never uses a partial or altered file. */
async function ensureModelFile() {
    return (await model.ensureFiles()).model;
}

/** Where the matcher runs on this machine, choosing (and timing) it on first call. */
function prepareDevice() {
    return model.prepareDevice();
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
        const outputs = await model.run((ort) => ({ images: new ort.Tensor("float32", pixels, [2, 1, height, width]) }));
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
    return model.device();
}

module.exports = { matchImages, ensureModelFile, prepareDevice, matcherDevice, setMatcherForTests, modelVersion, MODEL_EDGE, MODEL_SHA256 };
