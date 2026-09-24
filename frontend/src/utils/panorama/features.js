/**
 * SmartNav360 — ORB feature detection and matching (OpenCV.js)
 *
 * Extracted from the original planar stitcher (utils/stitchPanorama.js) so the
 * equirectangular stitcher can reuse the same detector/matcher without
 * inheriting that file's chained-homography compositing.
 *
 * OpenCV.js is a large WASM bundle, so it is only ever imported from inside a
 * function — never at module scope.
 */

const GOOD_MATCH_RATIO = 0.75;
/** Features are found on a downscaled copy; full resolution buys nothing here
 * and costs several seconds per frame in WASM. */
const DETECT_MAX_EDGE = 1024;
const ORB_FEATURES = 2500;

let cvPromise;

export async function loadOpenCV() {
  if (!cvPromise) {
    cvPromise = import("@techstark/opencv-js").then((mod) => {
      const cv = mod.default ?? mod;
      if (typeof cv.then === "function") return cv;
      if (cv.Mat) return cv;
      return new Promise((resolve) => {
        cv.onRuntimeInitialized = () => resolve(cv);
      });
    });
  }
  return cvPromise;
}

/**
 * Detects ORB keypoints/descriptors for one image.
 *
 * @param {any} cv
 * @param {HTMLImageElement|HTMLCanvasElement} image
 * @param {number} width - full-resolution width the keypoints are reported in.
 * @param {number} height - full-resolution height.
 * @returns {{ points: {x:number,y:number}[], descriptors: any, release: () => void }}
 */
export function detectFeatures(cv, image, width, height) {
  const scale = Math.min(1, DETECT_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

  const source = cv.imread(canvas);
  const gray = new cv.Mat();
  cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
  source.delete();

  const orb = new cv.ORB(ORB_FEATURES);
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const mask = new cv.Mat();
  orb.detectAndCompute(gray, mask, keypoints, descriptors);
  gray.delete();
  orb.delete();
  mask.delete();

  // Keypoints are copied out to plain objects and rescaled to full resolution
  // so the OpenCV vector can be freed immediately.
  const points = [];
  for (let i = 0; i < keypoints.size(); i += 1) {
    const { x, y } = keypoints.get(i).pt;
    points.push({ x: x / scale, y: y / scale });
  }
  keypoints.delete();

  return {
    points,
    descriptors,
    release: () => descriptors.delete(),
  };
}

/**
 * Brute-force Hamming matching with Lowe's ratio test.
 *
 * @returns {{ queryIdx: number, trainIdx: number }[]}
 */
export function matchDescriptors(cv, descriptorsA, descriptorsB) {
  if (descriptorsA.empty() || descriptorsB.empty()) return [];
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knnMatches = new cv.DMatchVectorVector();
  matcher.knnMatch(descriptorsA, descriptorsB, knnMatches, 2);

  const good = [];
  for (let i = 0; i < knnMatches.size(); i += 1) {
    const pair = knnMatches.get(i);
    if (pair.size() < 2) continue;
    const best = pair.get(0);
    const secondBest = pair.get(1);
    if (best.distance < GOOD_MATCH_RATIO * secondBest.distance) {
      good.push({ queryIdx: best.queryIdx, trainIdx: best.trainIdx });
    }
  }

  matcher.delete();
  knnMatches.delete();
  return good;
}
