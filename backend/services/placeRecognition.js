/**
 * Visual place recognition: "which scene am I standing in, facing which way?"
 *
 * Each scene's equirectangular panorama is rendered as a ring of ordinary
 * camera views, one every VIEW_STEP_DEG of yaw, and each view is embedded
 * with DINOv2-small (Oquab et al., 2023; Apache-2.0). A visitor's photo is
 * embedded the same way and compared against every view by cosine
 * similarity. The best view names the scene, and its yaw is the heading.
 *
 * This module is pure: rendering, preprocessing, descriptors and ranking take
 * pixel buffers and return numbers. Model loading and I/O live in
 * placeModel.js, so this file is exercised directly by the test suite.
 */

// A phone photo centre-cropped to a square keeps its short side's field of
// view: about 55° for a typical 26 mm-equivalent main camera held upright.
// Views are rendered to match, so a photo and the view it came from line up.
const VIEW_FOV_DEG = 55;
// Every 15°: fine enough that the heading is useful, cheap enough to index
// (24 views at ~35 ms each per scene).
const VIEW_STEP_DEG = 15;
const INPUT_SIZE = 224; // DINOv2 crop size
const RESIZE_SHORT_EDGE = 256; // DINOv2 preprocessing resizes before cropping

// Views that land mostly on the black, uncovered part of a partial panorama
// carry no information and would match any dark photo; they are not indexed.
const MAX_EMPTY_FRACTION = 0.35;
const EMPTY_PIXEL_SUM = 24; // r + g + b at or below this counts as uncovered

// Confidence thresholds on cosine similarity; see rankScenes for how they
// were chosen.
const HIGH_SCORE = 0.62;
const HIGH_GAP = 0.08;
const MEDIUM_SCORE = 0.55;
const MEDIUM_GAP = 0.03;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const DEG = Math.PI / 180;

/**
 * Renders a perspective view out of an equirectangular panorama.
 *
 * Yaw follows Marzipano's convention: 0 looks at the centre column of the
 * image and positive yaw turns right. That lets the heading returned by
 * locate() be handed straight to the viewer.
 *
 * @param {Uint8Array|Buffer} rgb - panorama pixels, 3 bytes per pixel
 * @param {number} width
 * @param {number} height
 * @param {{ yawDeg: number, pitchDeg?: number, fovDeg?: number, size?: number }} view
 * @returns {{ pixels: Uint8Array, emptyFraction: number }} size x size RGB
 */
function renderView(rgb, width, height, { yawDeg, pitchDeg = 0, fovDeg = VIEW_FOV_DEG, size = INPUT_SIZE }) {
  const out = new Uint8Array(size * size * 3);
  const half = Math.tan((fovDeg * DEG) / 2);
  const yaw = yawDeg * DEG;
  const pitch = pitchDeg * DEG;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let empty = 0;

  for (let v = 0; v < size; v += 1) {
    const y = -(((v + 0.5) / size) * 2 - 1) * half;
    for (let u = 0; u < size; u += 1) {
      const x = (((u + 0.5) / size) * 2 - 1) * half;
      // Camera ray, then pitch about x, then yaw about y.
      const len = Math.hypot(x, y, 1);
      const dx0 = x / len, dy0 = y / len, dz0 = 1 / len;
      const dy1 = dy0 * cp + dz0 * sp;
      const dz1 = -dy0 * sp + dz0 * cp;
      const dx = dx0 * cy + dz1 * sy;
      const dz = -dx0 * sy + dz1 * cy;
      const lon = Math.atan2(dx, dz);
      const lat = Math.asin(Math.max(-1, Math.min(1, dy1)));

      // Bilinear sample, wrapping horizontally across the seam.
      const fx = (lon / (2 * Math.PI) + 0.5) * width - 0.5;
      const fy = (0.5 - lat / Math.PI) * height - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const xa = ((x0 % width) + width) % width;
      const xb = (xa + 1) % width;
      const ya = Math.max(0, Math.min(height - 1, y0));
      const yb = Math.max(0, Math.min(height - 1, y0 + 1));

      const o = (v * size + u) * 3;
      let sum = 0;
      for (let c = 0; c < 3; c += 1) {
        const top = rgb[(ya * width + xa) * 3 + c] * (1 - tx) + rgb[(ya * width + xb) * 3 + c] * tx;
        const bottom = rgb[(yb * width + xa) * 3 + c] * (1 - tx) + rgb[(yb * width + xb) * 3 + c] * tx;
        const value = top * (1 - ty) + bottom * ty;
        out[o + c] = value;
        sum += value;
      }
      if (sum <= EMPTY_PIXEL_SUM) empty += 1;
    }
  }
  return { pixels: out, emptyFraction: empty / (size * size) };
}

/**
 * Normalises size x size RGB pixels into DINOv2's planar input
 * (1, 3, 224, 224) with ImageNet mean and standard deviation.
 */
function toModelInput(pixels, size = INPUT_SIZE) {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[c * plane + i] = (pixels[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return out;
}

/**
 * Global descriptor from DINOv2's last hidden state (257 x 384): the class
 * token concatenated with the mean of the 256 patch tokens, L2-normalised.
 * The class token carries overall scene identity; the patch mean keeps the
 * layout of large surfaces, which matters indoors where rooms share objects.
 *
 * @param {Float32Array} hidden - flattened (1, tokens, dim)
 * @param {number} tokens
 * @param {number} dim
 * @returns {Float32Array} length 2 * dim, unit length
 */
function descriptorFromHidden(hidden, tokens, dim) {
  const out = new Float32Array(2 * dim);
  for (let d = 0; d < dim; d += 1) out[d] = hidden[d];
  for (let t = 1; t < tokens; t += 1) {
    const base = t * dim;
    for (let d = 0; d < dim; d += 1) out[dim + d] += hidden[base + d];
  }
  for (let d = 0; d < dim; d += 1) out[dim + d] /= tokens - 1;

  // Balance the halves before joining them, or the larger-magnitude one
  // would dominate every similarity.
  normalizeRange(out, 0, dim);
  normalizeRange(out, dim, 2 * dim);
  return normalizeRange(out, 0, 2 * dim);
}

function normalizeRange(vector, start, end) {
  let norm = 0;
  for (let i = start; i < end; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = start; i < end; i += 1) vector[i] /= norm;
  return vector;
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** The yaws a panorama is indexed at: -180 .. 165 in VIEW_STEP_DEG steps. */
function viewYaws(step = VIEW_STEP_DEG) {
  const yaws = [];
  for (let yaw = -180; yaw < 180; yaw += step) yaws.push(yaw);
  return yaws;
}

/**
 * Ranks scenes for one query descriptor.
 *
 * A scene's score is its best-matching view. The heading is refined past the
 * 15° grid by fitting a parabola through the best view and its neighbours,
 * which is accurate to a few degrees when the neighbours were also indexed.
 *
 * Confidence needs both a high score and a clear gap to the runner-up. The
 * gap alone is not enough: a visitor standing somewhere that was never mapped
 * still gets a "best" scene, often well ahead of the others. The thresholds
 * were set on real indoor photos (13 in a mapped room, 14 with that room
 * removed from the index): correct matches scored 0.68-0.93, wrong ones never
 * above 0.49, and both thresholds sit inside that gap.
 *
 * @param {Float32Array} query
 * @param {{ sceneId: string, views: { yawDeg: number, vector: Float32Array }[] }[]} index
 * @returns {{ sceneId: string, score: number, yawDeg: number, confidence: 'high'|'medium'|'low' }[]}
 */
function rankScenes(query, index) {
  const ranked = [];
  for (const entry of index) {
    if (!entry.views.length) continue;
    const scored = entry.views.map((view) => ({ yawDeg: view.yawDeg, score: dot(query, view.vector) }));
    let best = 0;
    for (let i = 1; i < scored.length; i += 1) if (scored[i].score > scored[best].score) best = i;
    ranked.push({ sceneId: entry.sceneId, score: scored[best].score, yawDeg: refineYaw(scored, best) });
  }
  ranked.sort((a, b) => b.score - a.score);

  return ranked.map((entry, i) => {
    // With a single scene there is no runner-up; the score alone decides.
    const gap = ranked.length > 1 ? entry.score - ranked[1].score : Infinity;
    let confidence = 'low';
    if (i === 0) {
      if (entry.score >= HIGH_SCORE && gap >= HIGH_GAP) confidence = 'high';
      else if (entry.score >= MEDIUM_SCORE && gap >= MEDIUM_GAP) confidence = 'medium';
    }
    return { ...entry, score: round(entry.score), yawDeg: round(entry.yawDeg, 1), confidence };
  });
}

/** Parabolic peak interpolation over neighbouring views that are VIEW_STEP_DEG apart. */
function refineYaw(scored, best) {
  const at = (yaw) => scored.find((view) => Math.abs(wrapDeg(view.yawDeg - yaw)) < 1e-6);
  const centre = scored[best];
  const left = at(centre.yawDeg - VIEW_STEP_DEG);
  const right = at(centre.yawDeg + VIEW_STEP_DEG);
  if (!left || !right) return centre.yawDeg;
  const denominator = left.score - 2 * centre.score + right.score;
  if (denominator >= 0) return centre.yawDeg; // not a peak
  const offset = 0.5 * (left.score - right.score) / denominator; // in steps, within (-0.5, 0.5)
  return wrapDeg(centre.yawDeg + Math.max(-0.5, Math.min(0.5, offset)) * VIEW_STEP_DEG);
}

function wrapDeg(angle) {
  let wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180) wrapped = 180;
  return wrapped;
}

function round(value, places = 3) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

module.exports = {
  VIEW_FOV_DEG,
  VIEW_STEP_DEG,
  INPUT_SIZE,
  RESIZE_SHORT_EDGE,
  MAX_EMPTY_FRACTION,
  renderView,
  toModelInput,
  descriptorFromHidden,
  rankScenes,
  viewYaws,
  wrapDeg,
};
