/**
 * Loads CLIP ViT-B/32, which places text and images in one embedding space,
 * so "a whiteboard" can be compared directly with a view of a room.
 *
 * Model: CLIP ViT-B/32 (Radford et al., 2021), weights MIT-licensed by
 * OpenAI, via the ONNX export at huggingface.co/Xenova/clip-vit-base-patch32,
 * split into a text encoder and an image encoder, each dynamically quantised
 * to 8 bits (64 MB + 89 MB). The tokenizer files come from the same revision.
 * OpenAI's model card describes CLIP as a research model and asks deployers
 * to test it on their own data; the licence itself places no restriction.
 *
 * CPU only, on purpose: the 8-bit image encoder crashes the whole process
 * under DirectML (measured, RTX 3050), as the 8-bit DINOv2 does, and takes
 * about 22 ms per view on the CPU in a batch of 12. The text encoder takes
 * int64 input, which the device timing cannot exercise, and needs about 5 ms
 * per query anyway.
 *
 * Checked end to end on the COCO "two cats" photo (val2017 #39769): "a photo
 * of a cat" against "a photo of a dog" gives 0.993 for the cat, using CLIP's
 * own preprocessing and logit scale.
 */

const { defineModel } = require("../modelStore");
const { loadClipTokenizer } = require("./clipTokenizer");

const REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a";
const BASE_URL = `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/${REVISION}`;
const MODEL_VERSION = "clip-vit-b32-q8@d15189d";
const INPUT_SIZE = 224; // fixed by the vision transformer's position embeddings
const EMBEDDING_SIZE = 512;

// CLIP's own image normalisation (preprocessor_config.json), not ImageNet's.
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

const model = defineModel({
    id: "clip",
    label: "Text-to-scene search (CLIP ViT-B/32)",
    version: MODEL_VERSION,
    licence: "MIT",
    files: {
        vision: {
            name: "clip-vit-b32-vision-q8.onnx",
            url: `${BASE_URL}/onnx/vision_model_quantized.onnx`,
            sha256: "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299",
        },
        text: {
            name: "clip-vit-b32-text-q8.onnx",
            url: `${BASE_URL}/onnx/text_model_quantized.onnx`,
            sha256: "73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a",
        },
        vocab: {
            name: "clip-vit-b32-vocab.json",
            url: `${BASE_URL}/vocab.json`,
            sha256: "5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363",
        },
        merges: {
            name: "clip-vit-b32-merges.txt",
            url: `${BASE_URL}/merges.txt`,
            sha256: "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a",
        },
    },
    main: "vision",
    gpu: false,
});

let testEncoders = null;
let tokenizer = null;

/** The tokenizer, read once from the verified vocabulary files. A failure is not cached. */
function loadTokenizer() {
    // Opening the text session ensures (and if need be downloads) every file
    // of the model, and turns a missing one into the store's 503.
    tokenizer ||= model.session("text")
        .then(() => loadClipTokenizer(model.pathFor("vocab"), model.pathFor("merges")))
        .catch((error) => { tokenizer = null; throw error; });
    return tokenizer;
}

function normalize(vector) {
    const out = Float32Array.from(vector);
    let norm = 0;
    for (const value of out) norm += value * value;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < out.length; i += 1) out[i] /= norm;
    return out;
}

/**
 * Packs size x size RGB views into CLIP's planar input (n, 3, size, size),
 * scaled to 0-1 and normalised with CLIP's mean and standard deviation.
 * @param {Uint8Array[]} views
 */
function toClipInput(views, size = INPUT_SIZE) {
    const plane = size * size;
    const out = new Float32Array(views.length * 3 * plane);
    views.forEach((pixels, n) => {
        const base = n * 3 * plane;
        for (let i = 0; i < plane; i += 1) {
            for (let c = 0; c < 3; c += 1) {
                out[base + c * plane + i] = (pixels[i * 3 + c] / 255 - MEAN[c]) / STD[c];
            }
        }
    });
    return out;
}

/**
 * Embeds a search query.
 * @param {string} text
 * @returns {Promise<Float32Array>} unit length
 */
async function embedText(text) {
    if (testEncoders) return normalize(await testEncoders.text(text));
    const ids = (await loadTokenizer()).encode(text);
    const output = await model.run((ort) => ({
        input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    }), { role: "text" });
    return normalize(output.text_embeds.data);
}

/**
 * Embeds INPUT_SIZE x INPUT_SIZE RGB views, in one batch.
 * @param {Uint8Array[]} views
 * @returns {Promise<Float32Array[]>} one unit-length vector per view
 */
async function embedImages(views) {
    if (!views.length) return [];
    if (testEncoders) return Promise.all(views.map(async (pixels) => normalize(await testEncoders.image(pixels))));
    const output = await model.run((ort) => ({
        pixel_values: new ort.Tensor("float32", toClipInput(views), [views.length, 3, INPUT_SIZE, INPUT_SIZE]),
    }), { role: "vision" });
    const data = output.image_embeds.data;
    return views.map((_, n) => normalize(data.subarray(n * EMBEDDING_SIZE, (n + 1) * EMBEDDING_SIZE)));
}

/**
 * Replaces both encoders with deterministic functions in tests, so indexing,
 * ranking and the routes run without a 150 MB download. Pass null to restore.
 * @param {{ text: (text: string) => ArrayLike<number>, image: (pixels: Uint8Array) => ArrayLike<number> } | null} encoders
 */
function setEncodersForTests(encoders) {
    testEncoders = encoders;
}

function modelVersion() {
    return testEncoders ? "test-encoder" : MODEL_VERSION;
}

module.exports = {
    embedText,
    embedImages,
    toClipInput,
    setEncodersForTests,
    modelVersion,
    clipModel: model,
    INPUT_SIZE,
    EMBEDDING_SIZE,
    MODEL_VERSION,
};
