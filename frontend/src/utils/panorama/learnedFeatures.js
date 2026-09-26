/**
 * SmartNav360 — XFeat feature detection in the browser (ONNX Runtime Web)
 *
 * Loads the XFeat model on first use and turns a frame canvas into keypoints
 * and descriptors. Post-processing and matching live in ./xfeat.js.
 *
 * Both the runtime (~14 MB of WebAssembly) and the model (~2.8 MB) are fetched
 * only when a stitch actually runs — never at page load — the same rule the
 * OpenCV path follows.
 *
 * If either fails to load (offline without a cached copy, a browser without
 * WebAssembly SIMD, a blocked request) the caller falls back to ORB. A missing
 * model must never be the reason a panorama cannot be built.
 */

import { extractFeatures, pixelsToTensorData, xfeatInputSize } from "./xfeat.js";

const MODEL_DIR = `${import.meta.env.BASE_URL}models/xfeat/`;
const MODEL_FILE = "xfeat_backbone.onnx";
// The graph refers to its weights by this exact name; see public/models/xfeat/README.md.
const WEIGHTS_FILE = "xfeat_backbone.onnx.data";

let sessionPromise;

async function createSession() {
  const ort = await import("onnxruntime-web/wasm");
  // Multi-threaded WebAssembly needs cross-origin isolation (COOP/COEP
  // headers), which this app does not set. Pinning one thread avoids the
  // runtime probing for it and logging a warning on every load.
  ort.env.wasm.numThreads = 1;

  const session = await ort.InferenceSession.create(`${MODEL_DIR}${MODEL_FILE}`, {
    executionProviders: ["wasm"],
    externalData: [{ path: WEIGHTS_FILE, data: `${MODEL_DIR}${WEIGHTS_FILE}` }],
  });
  return { ort, session };
}

/**
 * Loads the model once per page. A failed load is not cached, so a later
 * stitch (after coming back online, say) tries again.
 * @returns {Promise<{ ort: any, session: any }>}
 */
export function loadXFeat() {
  if (!sessionPromise) {
    sessionPromise = createSession().catch((error) => {
      sessionPromise = undefined;
      throw error;
    });
  }
  return sessionPromise;
}

/**
 * Detects XFeat keypoints and descriptors for one frame.
 *
 * @param {{ ort: any, session: any }} model - from loadXFeat()
 * @param {HTMLCanvasElement} canvas - the frame at working resolution
 * @param {number} width - width the keypoints should be reported in
 * @param {number} height
 * @returns {Promise<{ points: {x:number,y:number}[], descriptors: Float32Array, count: number }>}
 */
export async function detectLearnedFeatures(model, canvas, width, height) {
  const { inputWidth, inputHeight } = xfeatInputSize(width, height);
  const scratch = document.createElement("canvas");
  scratch.width = inputWidth;
  scratch.height = inputHeight;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  context.drawImage(canvas, 0, 0, inputWidth, inputHeight);
  const { data } = context.getImageData(0, 0, inputWidth, inputHeight);

  const input = new model.ort.Tensor("float32", pixelsToTensorData(data, inputWidth, inputHeight, 4), [
    1,
    3,
    inputHeight,
    inputWidth,
  ]);
  const outputs = await model.session.run({ image: input });
  try {
    return extractFeatures(
      {
        heatmap: outputs.heatmap.data,
        reliability: outputs.reliability.data,
        descriptors: outputs.descriptors.data,
      },
      inputWidth,
      inputHeight,
      width,
      height,
    );
  } finally {
    // Output tensors hold WebAssembly memory until released.
    for (const tensor of Object.values(outputs)) tensor.dispose?.();
    input.dispose?.();
  }
}
