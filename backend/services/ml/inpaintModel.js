/**
 * Loads LaMa, the inpainting model that fills the uncovered (black) parts of a
 * stitched panorama with plausible texture: floor, wall, ceiling.
 *
 * LaMa (Suvorov et al., WACV 2022, "Resolution-robust Large Mask Inpainting
 * with Fourier Convolutions"; Apache-2.0), big-lama weights, as the ONNX
 * export at huggingface.co/Carve/LaMa-ONNX (lama_fp32.onnx, opset 17). The
 * graph is fixed at 512 x 512: an RGB image in 0..1 and a mask where 1 marks
 * pixels to fill; it returns the filled image in 0..255. Weights (208 MB) are
 * downloaded once, verified against a SHA-256, and cached (see modelStore.js).
 * Set INPAINT_MODEL_PATH to use a copy you provide.
 *
 * Runs on a GPU through DirectML when that is faster (see onnxDevice.js).
 */

const { defineModel } = require("../modelStore");

const INPUT_SIZE = 512; // fixed by the exported graph
const MODEL_VERSION = "big-lama-onnx-fp32@c3c0c9e";

const model = defineModel({
    id: "inpaint",
    label: "Panorama gap filling (LaMa)",
    version: MODEL_VERSION,
    licence: "Apache-2.0",
    files: {
        model: {
            name: "lama-fp32.onnx",
            url: "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx",
            sha256: "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
            envPath: "INPAINT_MODEL_PATH",
        },
    },
    // DirectML cannot run this export (a MatMul in the Fourier units fails with
    // "The parameter is incorrect" at every optimisation level), so LaMa runs
    // on the CPU: about 2.8 s per 512 x 512 view, in a background job.
    gpu: false,
    // 208 MB of weights plus a large activation footprint: do not keep them
    // loaded between the occasional fills.
    idleMs: 2 * 60 * 1000,
});

let testInpainter = null;

/**
 * Fills the masked pixels of one 512 x 512 view.
 * @param {Uint8Array} rgb - INPUT_SIZE x INPUT_SIZE x 3
 * @param {Uint8Array} mask - INPUT_SIZE x INPUT_SIZE, 1 where the pixel must be generated
 * @returns {Promise<Uint8Array>} the filled RGB view (known pixels may change slightly; callers keep the originals)
 */
async function inpaint(rgb, mask) {
    if (testInpainter) return testInpainter(rgb, mask);
    const plane = INPUT_SIZE * INPUT_SIZE;
    const image = new Float32Array(3 * plane);
    const holes = new Float32Array(plane);
    for (let i = 0; i < plane; i += 1) {
        image[i] = rgb[i * 3] / 255;
        image[plane + i] = rgb[i * 3 + 1] / 255;
        image[2 * plane + i] = rgb[i * 3 + 2] / 255;
        holes[i] = mask[i] ? 1 : 0;
    }
    const outputs = await model.run((ort) => ({
        image: new ort.Tensor("float32", image, [1, 3, INPUT_SIZE, INPUT_SIZE]),
        mask: new ort.Tensor("float32", holes, [1, 1, INPUT_SIZE, INPUT_SIZE]),
    }));
    const data = outputs[Object.keys(outputs)[0]].data;
    const out = new Uint8Array(plane * 3);
    for (let i = 0; i < plane; i += 1) {
        for (let c = 0; c < 3; c += 1) out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(data[c * plane + i])));
    }
    return out;
}

/** Replaces the model in tests, so the fill pipeline runs without a 208 MB download. */
function setInpainterForTests(fn) {
    testInpainter = fn;
}

function modelVersion() {
    return testInpainter ? "test-inpainter" : MODEL_VERSION;
}

module.exports = { inpaint, setInpainterForTests, modelVersion, model, INPUT_SIZE };
