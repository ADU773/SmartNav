/**
 * SmartNav360 — XFeat post-processing and matching (pure functions)
 *
 * XFeat (Potje et al., CVPR 2024) is a small learned keypoint detector and
 * descriptor. It replaces ORB for one reason: ORB fires on corners and
 * high-contrast edges, and indoor panoramas are mostly the opposite — painted
 * walls, ceilings, whiteboards. On those pairs ORB finds too few repeatable
 * points, and the stitcher has to fall back to raw sensor placement.
 *
 * The network itself runs in panorama/learnedFeatures.js through ONNX Runtime.
 * This module holds everything after inference, with no DOM, no runtime and no
 * I/O, so the exact code that ships can be validated in Node against real
 * captures.
 *
 * It mirrors kornia.feature.XFeat.detectAndCompute (Apache-2.0). The exported
 * model (kornia/xfeat, xfeat_backbone.onnx) already applies the keypoint
 * softmax and pixel shuffle, and already upsamples the reliability map, so its
 * three outputs are:
 *   heatmap      (1, 1, H, W)      keypoint probability per pixel
 *   reliability  (1, 1, H, W)      how trustworthy a location's descriptor is
 *   descriptors  (1, 64, H/8, W/8) dense descriptors, unit length per cell
 * where H and W are the input size, which must be multiples of 32.
 */

/** Longest input edge. Matches the ORB path's detection resolution. */
export const XFEAT_INPUT_MAX_EDGE = 1024;
export const XFEAT_DESCRIPTOR_DIM = 64;
/** kornia's default; below this a peak is noise, not a keypoint. */
export const XFEAT_DETECTION_THRESHOLD = 0.05;
const NMS_RADIUS = 2; // 5x5 window, as in kornia
/**
 * Keypoints kept per frame. Matching is all-pairs, so cost grows with the
 * square of this; 2048 keeps a pair well under a second in the browser while
 * still out-numbering ORB's 2500 once ORB's weak responses are discounted.
 */
export const XFEAT_TOP_K = 2048;
/**
 * Minimum cosine similarity for a mutual nearest neighbour to count.
 * The original XFeat matcher uses 0.82. RANSAC downstream removes geometric
 * outliers, but it cannot rescue a pair drowned in weak matches.
 */
export const XFEAT_MIN_COSINE = 0.82;

/**
 * Input size for a frame: long edge scaled down to XFEAT_INPUT_MAX_EDGE, then
 * each side floored to a multiple of 32, which the backbone's strides require.
 */
export function xfeatInputSize(width, height) {
  const scale = Math.min(1, XFEAT_INPUT_MAX_EDGE / Math.max(width, height));
  const floor32 = (value) => Math.max(32, Math.floor((value * scale) / 32) * 32);
  return { inputWidth: floor32(width), inputHeight: floor32(height) };
}

/**
 * Converts RGBA pixels to the model's planar float input, (3, H, W) in 0..1.
 * The network averages the channels and instance-normalises internally, so no
 * further scaling is needed here.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} [channels] - bytes per pixel in `rgba` (4 for canvas ImageData, 3 for raw RGB)
 */
export function pixelsToTensorData(rgba, width, height, channels = 4) {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const p = i * channels;
    out[i] = rgba[p] / 255;
    out[plane + i] = rgba[p + 1] / 255;
    out[2 * plane + i] = rgba[p + 2] / 255;
  }
  return out;
}

/**
 * Local maxima of the keypoint heatmap above threshold (5x5 NMS), scored as
 * heatmap x reliability exactly as kornia does, keeping the best `topK`.
 * Ties within a window keep every tied pixel, which matches max-pool NMS.
 */
function detectPeaks(heatmap, reliability, width, height, topK, threshold) {
  const candidates = [];
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const value = heatmap[row + x];
      if (value <= threshold) continue;
      let isMax = true;
      const y0 = Math.max(0, y - NMS_RADIUS);
      const y1 = Math.min(height - 1, y + NMS_RADIUS);
      const x0 = Math.max(0, x - NMS_RADIUS);
      const x1 = Math.min(width - 1, x + NMS_RADIUS);
      for (let ny = y0; ny <= y1 && isMax; ny += 1) {
        const nrow = ny * width;
        for (let nx = x0; nx <= x1; nx += 1) {
          if (heatmap[nrow + nx] > value) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) candidates.push({ x, y, score: value * reliability[row + x] });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > topK ? candidates.slice(0, topK) : candidates;
}

/** Keys cubic convolution weights with A = -0.75, as PyTorch's bicubic uses. */
function cubicWeights(t) {
  const A = -0.75;
  const w0 = ((A * (t + 1) - 5 * A) * (t + 1) + 8 * A) * (t + 1) - 4 * A;
  const w1 = ((A + 2) * t - (A + 3)) * t * t + 1;
  const u = 1 - t;
  const w2 = ((A + 2) * u - (A + 3)) * u * u + 1;
  const w3 = ((A * (2 - t) - 5 * A) * (2 - t) + 8 * A) * (2 - t) - 4 * A;
  return [w0, w1, w2, w3];
}

/**
 * Samples the dense descriptor map at keypoints, then L2-normalises.
 *
 * This deliberately reproduces an asymmetry in the reference implementation:
 * coordinates are normalised with a (W - 1) denominator but sampled with
 * align_corners = false. The pretrained weights were trained against that
 * convention, so "fixing" it here would quietly degrade every descriptor.
 * Out-of-bounds taps contribute zero (grid_sample's default padding).
 */
function sampleDescriptors(dense, featWidth, featHeight, points, inputWidth, inputHeight) {
  const dim = XFEAT_DESCRIPTOR_DIM;
  const plane = featWidth * featHeight;
  const out = new Float32Array(points.length * dim);

  for (let k = 0; k < points.length; k += 1) {
    const gx = (2 * points[k].x) / (inputWidth - 1) - 1;
    const gy = (2 * points[k].y) / (inputHeight - 1) - 1;
    const ix = ((gx + 1) * featWidth - 1) / 2;
    const iy = ((gy + 1) * featHeight - 1) / 2;
    const x0 = Math.floor(ix);
    const y0 = Math.floor(iy);
    const wx = cubicWeights(ix - x0);
    const wy = cubicWeights(iy - y0);

    const base = k * dim;
    for (let j = 0; j < 4; j += 1) {
      const sy = y0 - 1 + j;
      if (sy < 0 || sy >= featHeight) continue;
      for (let i = 0; i < 4; i += 1) {
        const sx = x0 - 1 + i;
        if (sx < 0 || sx >= featWidth) continue;
        const weight = wx[i] * wy[j];
        const offset = sy * featWidth + sx;
        for (let c = 0; c < dim; c += 1) out[base + c] += weight * dense[c * plane + offset];
      }
    }

    let norm = 0;
    for (let c = 0; c < dim; c += 1) norm += out[base + c] * out[base + c];
    norm = Math.sqrt(norm) || 1;
    for (let c = 0; c < dim; c += 1) out[base + c] /= norm;
  }
  return out;
}

/**
 * Turns raw model outputs into keypoints and descriptors.
 *
 * @param {{ heatmap: Float32Array, reliability: Float32Array, descriptors: Float32Array }} outputs
 * @param {number} inputWidth - width the model was run at (multiple of 32).
 * @param {number} inputHeight
 * @param {number} frameWidth - width the keypoints should be reported in.
 * @param {number} frameHeight
 * @returns {{ points: {x:number,y:number}[], descriptors: Float32Array, count: number }}
 */
export function extractFeatures(outputs, inputWidth, inputHeight, frameWidth, frameHeight, options = {}) {
  const { topK = XFEAT_TOP_K, threshold = XFEAT_DETECTION_THRESHOLD } = options;
  const featWidth = Math.floor((inputWidth - 1) / 8) + 1;
  const featHeight = Math.floor((inputHeight - 1) / 8) + 1;

  const peaks = detectPeaks(outputs.heatmap, outputs.reliability, inputWidth, inputHeight, topK, threshold);
  const descriptors = sampleDescriptors(outputs.descriptors, featWidth, featHeight, peaks, inputWidth, inputHeight);

  const scaleX = frameWidth / inputWidth;
  const scaleY = frameHeight / inputHeight;
  return {
    points: peaks.map((peak) => ({ x: peak.x * scaleX, y: peak.y * scaleY })),
    descriptors,
    count: peaks.length,
  };
}

/**
 * Mutual nearest-neighbour matching on unit-length descriptors.
 *
 * One pass over the similarity matrix tracks both each row's and each
 * column's best, so the matrix is never materialised.
 *
 * @returns {{ queryIdx: number, trainIdx: number, similarity: number }[]}
 */
export function matchMutualNearest(descriptorsA, countA, descriptorsB, countB, minCosine = XFEAT_MIN_COSINE) {
  if (!countA || !countB) return [];
  const dim = XFEAT_DESCRIPTOR_DIM;
  const rowBest = new Int32Array(countA).fill(-1);
  const rowScore = new Float32Array(countA).fill(-Infinity);
  const colBest = new Int32Array(countB).fill(-1);
  const colScore = new Float32Array(countB).fill(-Infinity);

  for (let i = 0; i < countA; i += 1) {
    const a = i * dim;
    for (let j = 0; j < countB; j += 1) {
      const b = j * dim;
      let dot = 0;
      for (let c = 0; c < dim; c += 1) dot += descriptorsA[a + c] * descriptorsB[b + c];
      if (dot > rowScore[i]) {
        rowScore[i] = dot;
        rowBest[i] = j;
      }
      if (dot > colScore[j]) {
        colScore[j] = dot;
        colBest[j] = i;
      }
    }
  }

  const matches = [];
  for (let i = 0; i < countA; i += 1) {
    const j = rowBest[i];
    if (j >= 0 && colBest[j] === i && rowScore[i] > minCosine) {
      matches.push({ queryIdx: i, trainIdx: j, similarity: rowScore[i] });
    }
  }
  return matches;
}
