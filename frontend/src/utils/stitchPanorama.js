/**
 * SmartNav360 — Panorama Stitcher
 * Real feature-based image stitching via OpenCV.js, run entirely in the
 * browser. OpenCV.js is a large WASM bundle, so it must only ever be loaded
 * from inside stitchImages() — never at module import time.
 *
 * The installed opencv.js build has no high-level cv.Stitcher (most
 * standard opencv.js builds, including the official docs.opencv.org one,
 * omit the stitching module). This implements the same technique by hand:
 * ORB feature detection, BFMatcher + Lowe's ratio test, RANSAC homography,
 * then warpPerspective to align and composite each photo onto a growing
 * canvas, one pair at a time.
 */

const GOOD_MATCH_RATIO = 0.75;
const MIN_GOOD_MATCHES = 10;
const RANSAC_REPROJ_THRESHOLD = 3;

export class StitchError extends Error {
  constructor(reason) {
    const messages = {
      'not-enough-photos': 'At least two photos are required to build a panorama.',
      'no-features': 'Could not find enough distinct detail in these photos to align them. Retake them somewhere with more texture or detail.',
      'not-enough-matches': 'Not enough overlap between these photos to build a panorama. Retake them with more overlap between each shot.',
      'homography-failed': 'These photos could not be aligned into a panorama. Retake them with more overlap and try to keep the camera level.',
    };
    super(messages[reason] || 'Could not stitch these photos into a panorama. Retake them with more overlap.');
    this.name = 'StitchError';
    this.reason = reason;
  }
}

let cvPromise;

async function loadOpenCV() {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then((mod) => {
      const cv = mod.default ?? mod;
      // The default export resolves once the WASM runtime is ready on
      // recent versions; fall back to the classic onRuntimeInitialized
      // callback used by raw opencv.js builds.
      if (typeof cv.then === 'function') return cv;
      if (cv.Mat) return cv;
      return new Promise((resolve) => {
        cv.onRuntimeInitialized = () => resolve(cv);
      });
    });
  }
  return cvPromise;
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load a captured photo.'));
    img.src = url;
  });
}

function matFromImageElement(cv, img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return cv.imread(canvas);
}

/**
 * Detects ORB keypoints/descriptors for a color Mat.
 */
function detectFeatures(cv, colorMat) {
  const gray = new cv.Mat();
  cv.cvtColor(colorMat, gray, cv.COLOR_RGBA2GRAY);
  const orb = new cv.ORB(2000);
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const mask = new cv.Mat();
  orb.detectAndCompute(gray, mask, keypoints, descriptors);
  gray.delete();
  orb.delete();
  mask.delete();
  return { keypoints, descriptors };
}

/**
 * Matches descriptors with a ratio test, returning [{ queryIdx, trainIdx }].
 */
function matchFeatures(cv, descriptorsA, descriptorsB) {
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

/**
 * Aligns `nextMat` onto `baseMat` via ORB + homography, returning a new,
 * larger composite Mat covering both images. Caller owns the result.
 */
function stitchPair(cv, baseMat, nextMat) {
  const baseFeatures = detectFeatures(cv, baseMat);
  const nextFeatures = detectFeatures(cv, nextMat);

  if (baseFeatures.keypoints.size() < MIN_GOOD_MATCHES || nextFeatures.keypoints.size() < MIN_GOOD_MATCHES) {
    baseFeatures.keypoints.delete(); baseFeatures.descriptors.delete();
    nextFeatures.keypoints.delete(); nextFeatures.descriptors.delete();
    throw new StitchError('no-features');
  }

  const good = matchFeatures(cv, baseFeatures.descriptors, nextFeatures.descriptors);
  if (good.length < MIN_GOOD_MATCHES) {
    baseFeatures.keypoints.delete(); baseFeatures.descriptors.delete();
    nextFeatures.keypoints.delete(); nextFeatures.descriptors.delete();
    throw new StitchError('not-enough-matches');
  }

  const srcArr = [];
  const dstArr = [];
  for (const { queryIdx, trainIdx } of good) {
    const basePoint = baseFeatures.keypoints.get(queryIdx).pt;
    const nextPoint = nextFeatures.keypoints.get(trainIdx).pt;
    srcArr.push(nextPoint.x, nextPoint.y);
    dstArr.push(basePoint.x, basePoint.y);
  }
  baseFeatures.keypoints.delete(); baseFeatures.descriptors.delete();
  nextFeatures.keypoints.delete(); nextFeatures.descriptors.delete();

  const srcMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, srcArr);
  const dstMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, dstArr);
  const inlierMask = new cv.Mat();
  const homography = cv.findHomography(srcMat, dstMat, cv.RANSAC, RANSAC_REPROJ_THRESHOLD, inlierMask);
  srcMat.delete(); dstMat.delete(); inlierMask.delete();

  if (homography.empty()) {
    homography.delete();
    throw new StitchError('homography-failed');
  }

  // Transform nextMat's corners to find the output canvas bounds.
  const w1 = baseMat.cols; const h1 = baseMat.rows;
  const w2 = nextMat.cols; const h2 = nextMat.rows;
  const corners = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w2, 0, w2, h2, 0, h2]);
  const warpedCorners = new cv.Mat();
  cv.perspectiveTransform(corners, warpedCorners, homography);
  corners.delete();

  const xs = [0, w1];
  const ys = [0, h1];
  for (let i = 0; i < 4; i += 1) {
    xs.push(warpedCorners.data32F[i * 2]);
    ys.push(warpedCorners.data32F[i * 2 + 1]);
  }
  warpedCorners.delete();

  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const tx = -Math.min(0, minX);
  const ty = -Math.min(0, minY);
  const outW = Math.ceil(maxX - Math.min(0, minX));
  const outH = Math.ceil(maxY - Math.min(0, minY));

  const translation = cv.matFromArray(3, 3, cv.CV_64F, [1, 0, tx, 0, 1, ty, 0, 0, 1]);
  const combinedHomography = new cv.Mat();
  cv.gemm(translation, homography, 1, new cv.Mat(), 0, combinedHomography);
  homography.delete();

  const warpedBase = new cv.Mat();
  cv.warpPerspective(baseMat, warpedBase, translation, new cv.Size(outW, outH));
  translation.delete();

  const warpedNext = new cv.Mat();
  cv.warpPerspective(nextMat, warpedNext, combinedHomography, new cv.Size(outW, outH));
  combinedHomography.delete();

  // Composite: start from the warped base, then overlay the warped next
  // image everywhere it has content (simple non-blend overwrite — visible
  // seams are possible, but alignment is real, feature-based geometry).
  const composite = warpedBase.clone();
  for (let row = 0; row < outH; row += 1) {
    for (let col = 0; col < outW; col += 1) {
      const idx = (row * outW + col) * 4;
      const hasContent = warpedNext.data[idx] || warpedNext.data[idx + 1] || warpedNext.data[idx + 2] || warpedNext.data[idx + 3];
      if (hasContent) {
        composite.data[idx] = warpedNext.data[idx];
        composite.data[idx + 1] = warpedNext.data[idx + 1];
        composite.data[idx + 2] = warpedNext.data[idx + 2];
        composite.data[idx + 3] = warpedNext.data[idx + 3];
      }
    }
  }

  warpedBase.delete();
  warpedNext.delete();
  return composite;
}

/**
 * Stitches several overlapping photos into one panorama image.
 * @param {string[]} imageUrls - URLs of the source photos, in capture order.
 * @param {(info: { stage: string, index?: number, total?: number }) => void} [onProgress]
 * @returns {Promise<Blob>} The stitched panorama as a JPEG blob.
 */
export async function stitchImages(imageUrls, onProgress) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 2) {
    throw new StitchError('not-enough-photos');
  }

  onProgress?.({ stage: 'loading-library' });
  const cv = await loadOpenCV();

  const sourceMats = [];
  try {
    for (let i = 0; i < imageUrls.length; i += 1) {
      onProgress?.({ stage: 'loading-photo', index: i + 1, total: imageUrls.length });
      const img = await loadImageElement(imageUrls[i]);
      sourceMats.push(matFromImageElement(cv, img));
    }

    onProgress?.({ stage: 'stitching' });
    let composite = sourceMats[0].clone();
    for (let i = 1; i < sourceMats.length; i += 1) {
      const next = stitchPair(cv, composite, sourceMats[i]);
      composite.delete();
      composite = next;
    }

    const outCanvas = document.createElement('canvas');
    cv.imshow(outCanvas, composite);
    composite.delete();

    onProgress?.({ stage: 'done' });
    return await new Promise((resolve, reject) => {
      outCanvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode the stitched panorama.'));
      }, 'image/jpeg', 0.92);
    });
  } finally {
    sourceMats.forEach((mat) => mat.delete());
  }
}
