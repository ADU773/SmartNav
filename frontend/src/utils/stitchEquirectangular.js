/**
 * SmartNav360 — Hybrid Equirectangular Panorama Stitcher
 *
 * Sensors initialise, image content decides.
 *
 * The first version of this file placed each photo straight onto the
 * equirectangular canvas at its DeviceMotion yaw/pitch, assuming a fixed 65°
 * horizontal field of view. On a real iPhone capture that produced visible
 * ghosting: gyroscope-integrated yaw drifts, residual pitch survives even a
 * good capture guide, and one hard-coded field of view is wrong for every
 * phone and wrong again when the phone is held in portrait. An error of a
 * degree or two, or a focal length off by ten percent, doubles every edge in
 * the overlap.
 *
 * So the metadata is now treated as what it is — a good starting guess. Each
 * adjacent pair of frames is registered against its own overlapping pixels
 * (XFeat learned features with mutual nearest-neighbour matching, falling back
 * to ORB with Lowe's ratio test, then RANSAC over a rotation-only model), one
 * shared focal length is solved for from those same correspondences, and any
 * loop-closure error is spread around the circle. Only then are the frames
 * reprojected.
 *
 * What this deliberately is not: the old planar chained-homography mosaic
 * (utils/stitchPanorama.js). A homography can express translation and shear
 * that a camera turning in place cannot produce, and a planar canvas cannot
 * represent more than about a hemisphere. The model here is a pure rotation
 * per frame onto a sphere, which is what Marzipano's EquirectGeometry expects.
 *
 * Remaining simplifications, stated rather than hidden:
 *  - One focal length and no lens distortion model. Phone wide lenses have
 *    mild barrel distortion that shows as small residuals at frame corners.
 *  - Feather blending by distance from frame centre, with no exposure
 *    compensation, so a bright window in one frame still shifts that frame's
 *    overall brightness.
 *  - Loop closure distributes error evenly instead of running a full bundle
 *    adjustment over all frames at once.
 */

import { loadOpenCV, detectFeatures, matchDescriptors } from "./panorama/features";
import { loadXFeat, detectLearnedFeatures } from "./panorama/learnedFeatures";
import { matchMutualNearest } from "./panorama/xfeat";
import {
  DEG,
  fovFromFocal,
  focalFromFov,
  matApply,
  matMul,
  matTranspose,
  yawPitchRollFromRotation,
} from "./panorama/rotation";
import {
  applyLoopClosure,
  chainRotations,
  describePlacement,
  estimatePairRotation,
  refineFocalLength,
  sensorRotation,
  yawSpanDeg,
  LOOP_CLOSURE_MIN_SPAN_DEG,
} from "./panorama/registration";

/**
 * Starting estimate for the field of view across the *longer* image axis.
 *
 * Phone main cameras cluster near 26 mm equivalent, which puts the long axis
 * of a full-sensor 4:3 frame around 67-69°. Treat this as a seed and nothing
 * more: it is only correct when the image really is the full sensor frame. A
 * phone that hands back a screen-shaped crop has thrown away field of view
 * along one axis, and no fixed constant can know that happened. The value
 * that ends up being used is solved from the photographs — see
 * refineFocalLength, whose search range is deliberately wide enough to cover
 * a heavily cropped frame.
 */
const DEFAULT_LONG_AXIS_FOV_DEG = 69;

const OUTPUT_WIDTH = 4000; // matches the width passed to Marzipano.EquirectGeometry
const OUTPUT_HEIGHT = OUTPUT_WIDTH / 2;
/** Source frames are downscaled to this before use: each frame covers roughly
 * a sixth of the output width, so full camera resolution is pure memory cost. */
const SOURCE_MAX_EDGE = 1600;
const ROW_CHUNK = 32; // rows per tick, keeps the tab responsive
/** Padding on each frame's angular footprint when choosing candidate columns. */
const FOOTPRINT_MARGIN_RAD = 2 * DEG;
/** Below this much overlap between neighbouring frames, feature matching has
 * nothing to work with and the capture geometry itself is the problem. */
const MIN_USABLE_OVERLAP_DEG = 12;

export class EquirectStitchError extends Error {
  constructor(reason) {
    const messages = {
      "not-enough-photos": "At least two photos are required to build a panorama.",
      "no-coverage": "These photos don't cover enough of the turn to build a panorama.",
    };
    super(messages[reason] || "Could not stitch these photos into a panorama.");
    this.name = "EquirectStitchError";
    this.reason = reason;
  }
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load a captured photo."));
    img.src = url;
  });
}

/**
 * Draws a photo into a working-resolution canvas.
 *
 * Portrait captures matter here. An iPhone held upright writes a portrait
 * image, so the image *width* is the sensor's shorter axis and spans the
 * smaller angle. Deriving the focal length from the longer axis and then
 * reading the horizontal field of view back out of it keeps portrait and
 * landscape frames consistent; treating the width as if it always carried the
 * full ~69° is what made portrait frames roughly 20% too wide on the canvas.
 *
 * The aspect ratio that arrives here is itself evidence and is reported: a
 * 4:3 frame (0.75) is the full sensor, while something near 0.46 is a
 * screen-shaped crop that has lost most of its horizontal field of view — and
 * with it most of the overlap the stitcher needs.
 */
function toWorkingCanvas(image) {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, SOURCE_MAX_EDGE / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function pairLabel(from, to) {
  return `${from + 1} → ${to + 1}`;
}

/** Lets React paint a progress update between long synchronous steps. */
function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Stitches captured frames into one equirectangular panorama.
 *
 * @param {{ url: string, yawDeg?: number, pitchDeg?: number, rollDeg?: number }[]} photos
 *        In capture order. Frames without metadata are assumed evenly spaced.
 * @param {(info: { stage: string, index?: number, total?: number, percent?: number, detail?: string }) => void} [onProgress]
 * @returns {Promise<{ blob: Blob, report: object }>}
 */
export async function stitchEquirectangular(photos, onProgress) {
  if (!Array.isArray(photos) || photos.length < 2) {
    throw new EquirectStitchError("not-enough-photos");
  }

  const count = photos.length;
  const report = {
    frameCount: count,
    pairs: [],
    fallbackPairs: [],
    loopClosureDeg: null,
    focalRefined: false,
    notes: [],
    matcher: "orb",
    matcherCounts: { xfeat: 0, orb: 0 },
  };

  /* ---- 1. Load frames at working resolution ---- */

  const frames = [];
  for (let i = 0; i < count; i += 1) {
    onProgress?.({ stage: "loading-photo", index: i + 1, total: count });
    const image = await loadImageElement(photos[i].url);
    const canvas = toWorkingCanvas(image);
    const context = canvas.getContext("2d");
    frames.push({
      canvas,
      data: context.getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
      sensor: sensorRotation(photos[i], i, count),
    });
  }

  const longAxis = Math.max(frames[0].width, frames[0].height);
  const initialFocal = focalFromFov(longAxis, DEFAULT_LONG_AXIS_FOV_DEG * DEG);
  report.initialHfovDeg = fovFromFocal(frames[0].width, initialFocal) / DEG;

  /* ---- 2. Detect features once per frame ----------------------------
   *
   * XFeat, a small learned detector, is the primary matcher. ORB stays as a
   * per-pair fallback and is computed lazily — only for frames in a pair that
   * XFeat could not register — so the common path pays for one detector, and
   * no pair can end up worse off than it was with ORB alone.
   *
   * Measured on a real 13-frame indoor iPhone capture using this file's own
   * registration code: XFeat produced 2.3-3.3x the RANSAC inliers of ORB, and
   * where both registered a pair their rotations agreed to within 0.7°. It
   * does not create overlap that is not there; pairs with no shared content
   * still fall back to the sensors with either matcher.
   */

  onProgress?.({ stage: "loading-model" });
  let xfeatModel = null;
  try {
    xfeatModel = await loadXFeat();
    report.matcher = "xfeat";
  } catch (error) {
    report.notes.push(
      `The learned feature matcher could not be loaded (${error?.message || "unknown error"}), so every pair used ORB.`,
    );
  }

  const learned = [];
  const orb = new Array(count).fill(null);
  let cv = null;

  const orbFor = async (index) => {
    if (!orb[index]) {
      cv ||= await loadOpenCV();
      orb[index] = detectFeatures(cv, frames[index].canvas, frames[index].width, frames[index].height);
    }
    return orb[index];
  };

  try {
    for (let i = 0; i < count; i += 1) {
      onProgress?.({ stage: "features", index: i + 1, total: count });
      await yieldToBrowser();
      if (xfeatModel) {
        learned.push(await detectLearnedFeatures(xfeatModel, frames[i].canvas, frames[i].width, frames[i].height));
      } else {
        await orbFor(i);
      }
    }

    /* ---- 3. Match and register each adjacent pair ---- */

    // The last frame is matched back to the first only when the capture really
    // did go the whole way round; four frames spanning 90° have no loop to close.
    const sensorSpan = yawSpanDeg(frames.map((frame) => frame.sensor));
    const attemptLoopClosure = count >= 3 && sensorSpan >= LOOP_CLOSURE_MIN_SPAN_DEG;

    const links = [];
    for (let i = 0; i < count - 1; i += 1) links.push([i, i + 1]);
    if (attemptLoopClosure) links.push([count - 1, 0]);

    const learnedMatches = (fromIndex, toIndex) => {
      const a = learned[fromIndex];
      const b = learned[toIndex];
      return matchMutualNearest(a.descriptors, a.count, b.descriptors, b.count).map((m) => ({
        x1: a.points[m.queryIdx].x,
        y1: a.points[m.queryIdx].y,
        x2: b.points[m.trainIdx].x,
        y2: b.points[m.trainIdx].y,
      }));
    };

    const orbMatches = async (fromIndex, toIndex) => {
      const a = await orbFor(fromIndex);
      const b = await orbFor(toIndex);
      return matchDescriptors(cv, a.descriptors, b.descriptors).map((m) => ({
        x1: a.points[m.queryIdx].x,
        y1: a.points[m.queryIdx].y,
        x2: b.points[m.trainIdx].x,
        y2: b.points[m.trainIdx].y,
      }));
    };

    /**
     * Registers one pair. With `cached` (the second, calibrated pass) the
     * matches that won the first pass are reused as-is.
     */
    const estimatePair = async (fromIndex, toIndex, focal, options, cached) => {
      const frameA = frames[fromIndex];
      const frameB = frames[toIndex];
      const sensorRelative = matMul(matTranspose(frameA.sensor), frameB.sensor);
      const run = (matches, matcher) => ({
        ...estimatePairRotation(matches, frameA, frameB, focal, sensorRelative, options),
        frameA,
        frameB,
        from: fromIndex,
        to: toIndex,
        matches,
        matcher,
      });

      if (cached) return run(cached.matches, cached.matcher);

      let primary = null;
      if (learned.length) {
        primary = run(learnedMatches(fromIndex, toIndex), "xfeat");
        if (primary.source === "image") return primary;
      }
      const fallback = run(await orbMatches(fromIndex, toIndex), "orb");
      // Keep whichever registered. If neither did, report the learned result:
      // its match counts say more about why the pair failed.
      if (!primary || fallback.source === "image") return fallback;
      return primary;
    };

    /* ---- 3a. Broad first pass ------------------------------------------
     *
     * No overlap mask here, deliberately. The mask is derived from the focal
     * length, the focal length is what this pass exists to calibrate, and
     * running the mask first closes that loop: an initial field of view that
     * is too narrow hides the very correspondences needed to discover that it
     * is too narrow. So the first pass matches everything and leans on RANSAC
     * plus the sensor-disagreement guard to reject nonsense instead.
     */
    let pairs = [];
    for (let i = 0; i < links.length; i += 1) {
      const [from, to] = links[i];
      onProgress?.({
        stage: "matching",
        index: i + 1,
        total: links.length,
        detail: pairLabel(from, to),
      });
      await yieldToBrowser();
      pairs.push(await estimatePair(from, to, initialFocal, { overlapCheck: false }));
    }

    /* ---- 4. Solve one focal length from the correspondences ---- */

    onProgress?.({ stage: "calibrating" });
    const focalResult = refineFocalLength(pairs, initialFocal);
    let focal = focalResult.focal;
    report.focalRefined = focalResult.refined;
    report.focalScale = focal / initialFocal;
    report.focalReason = focalResult.reason;
    report.focalErrorPx = focalResult.bestErrorPx;
    report.focalBaselineErrorPx = focalResult.baselineErrorPx;
    if (!focalResult.refined && focalResult.baselineErrorPx !== null) {
      report.notes.push(`Field of view kept at the ${report.initialHfovDeg.toFixed(0)}° estimate: ${focalResult.reason}.`);
    }

    if (focalResult.refined) {
      /* ---- 3b. Second pass with the calibrated geometry ----------------
       *
       * Now the overlap mask means something, so it is switched on: it drops
       * descriptor matches that cannot be the same world point and gives
       * RANSAC a cleaner set. A pair only adopts this result if it does at
       * least as well as the broad pass — a tighter mask must never cost a
       * pair its registration.
       */
      onProgress?.({ stage: "aligning", index: 0, total: pairs.length });
      const refinedPairs = [];
      for (let i = 0; i < pairs.length; i += 1) {
        const pair = pairs[i];
        onProgress?.({
          stage: "aligning",
          index: i + 1,
          total: pairs.length,
          detail: pairLabel(pair.from, pair.to),
        });
        const refined = await estimatePair(pair.from, pair.to, focal, { overlapCheck: true }, {
          matches: pair.matches,
          matcher: pair.matcher,
        });
        if (refined.source === "image" && refined.inlierMatches.length >= pair.inlierMatches.length) refinedPairs.push(refined);
        else if (refined.source === "image" && pair.source === "sensor") refinedPairs.push(refined);
        else refinedPairs.push(pair);
      }
      pairs = refinedPairs;
    }

    report.focalPx = focal;
    report.hfovDeg = fovFromFocal(frames[0].width, focal) / DEG;
    report.vfovDeg = fovFromFocal(frames[0].height, focal) / DEG;
    report.frames = frames.map((frame, i) => ({
      index: i + 1,
      width: frame.width,
      height: frame.height,
      aspect: frame.width / frame.height,
      keypoints: learned[i] ? learned[i].count : orb[i]?.points.length ?? 0,
    }));

    for (const pair of pairs) {
      const entry = {
        pair: pairLabel(pair.from, pair.to),
        source: pair.source,
        matcher: pair.matcher,
        ...pair.stats,
      };
      if (pair.source === "image") report.matcherCounts[pair.matcher] += 1;
      if (pair.source === "sensor") {
        entry.reason = pair.reason;
        report.fallbackPairs.push(`${entry.pair}: ${pair.reason}`);
      }
      report.pairs.push(entry);
    }

    /* ---- 4b. Sanity-check the capture geometry itself ----
     *
     * A stitch can fail for a reason no amount of registration can fix: if the
     * frames were taken further apart than the lens is wide, there is no
     * shared content to register. Saying so is more useful than reporting
     * three mysterious fallbacks. */
    const steps = [];
    for (let i = 1; i < count; i += 1) {
      const previous = yawPitchRollFromRotation(frames[i - 1].sensor).yaw;
      const current = yawPitchRollFromRotation(frames[i].sensor).yaw;
      let delta = (current - previous) % (2 * Math.PI);
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta <= -Math.PI) delta += 2 * Math.PI;
      steps.push(Math.abs(delta) / DEG);
    }
    const medianStep = steps.length ? steps.slice().sort((a, b) => a - b)[Math.floor(steps.length / 2)] : 0;
    report.medianYawStepDeg = medianStep;
    report.overlapDeg = report.hfovDeg - medianStep;
    if (medianStep > 0 && report.overlapDeg < MIN_USABLE_OVERLAP_DEG) {
      report.notes.push(
        `Frames are about ${medianStep.toFixed(0)}° apart but the lens only covers ${report.hfovDeg.toFixed(
          0,
        )}°, leaving roughly ${Math.max(0, report.overlapDeg).toFixed(0)}° of overlap. Feature matching needs more than that.`,
      );
    }
    if (report.frames[0].aspect < 0.6) {
      report.notes.push(
        `Frames are ${report.frames[0].width}x${report.frames[0].height} (aspect ${report.frames[0].aspect.toFixed(
          3,
        )}), which is screen-shaped rather than the camera's native 4:3. The capture is probably being cropped, which throws away horizontal field of view and therefore overlap.`,
      );
    }

    /* ---- 5. Chain into absolute orientations, then close the loop ---- */

    const sequential = pairs.filter((pair) => pair.to === pair.from + 1);
    const closing = attemptLoopClosure ? pairs.find((pair) => pair.to === 0 && pair.from === count - 1) : null;

    let rotations = chainRotations(frames[0].sensor, sequential.map((pair) => pair.rotation));
    if (closing && closing.source === "image") {
      onProgress?.({ stage: "loop-closure" });
      const closed = applyLoopClosure(rotations, closing.rotation);
      rotations = closed.rotations;
      report.loopClosureDeg = closed.appliedDeg;
    }

    report.placement = describePlacement(rotations);

    /* ---- 6. Reproject ---- */

    const blob = await project(frames, rotations, focal, onProgress);
    onProgress?.({ stage: "done" });
    return { blob, report };
  } finally {
    orb.forEach((entry) => entry?.release());
  }
}

/**
 * Reprojects every frame onto the equirectangular canvas using its final
 * rotation.
 *
 * For each output pixel the world ray is rotated into each candidate frame's
 * camera coordinates and projected through the pinhole model. Going this way
 * round — output pixel to source pixel — means every output pixel is filled
 * exactly once, and the full rotation matrix is used, so roll is handled
 * properly rather than ignored.
 */
async function project(frames, rotations, focal, onProgress) {
  const count = frames.length;
  const inverse = rotations.map((rotation) => matTranspose(rotation));

  // Angular footprint of each frame, used to shortlist frames per column.
  const footprints = frames.map((frame, i) => {
    const diagonalHalfAngle = Math.atan(Math.hypot(frame.width / 2, frame.height / 2) / focal);
    const { yaw } = yawPitchRollFromRotation(rotations[i]);
    return { yaw, halfAngle: diagonalHalfAngle + FOOTPRINT_MARGIN_RAD };
  });

  const columnSources = new Array(OUTPUT_WIDTH);
  const sinTheta = new Float64Array(OUTPUT_WIDTH);
  const cosTheta = new Float64Array(OUTPUT_WIDTH);
  for (let px = 0; px < OUTPUT_WIDTH; px += 1) {
    const theta = (px / OUTPUT_WIDTH) * 2 * Math.PI - Math.PI;
    sinTheta[px] = Math.sin(theta);
    cosTheta[px] = Math.cos(theta);
    const candidates = [];
    for (let s = 0; s < count; s += 1) {
      let delta = (theta - footprints[s].yaw) % (2 * Math.PI);
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta <= -Math.PI) delta += 2 * Math.PI;
      if (Math.abs(delta) <= footprints[s].halfAngle) candidates.push(s);
    }
    columnSources[px] = candidates;
  }

  if (!columnSources.some((list) => list.length > 0)) {
    throw new EquirectStitchError("no-coverage");
  }

  const output = new Uint8ClampedArray(OUTPUT_WIDTH * OUTPUT_HEIGHT * 4);

  const sampleBilinear = (frame, x, y, out) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, frame.width - 1);
    const y1 = Math.min(y0 + 1, frame.height - 1);
    const fx = x - x0;
    const fy = y - y0;
    const pixels = frame.data.data;
    const rowTop = y0 * frame.width;
    const rowBottom = y1 * frame.width;
    for (let c = 0; c < 3; c += 1) {
      const top = pixels[(rowTop + x0) * 4 + c] * (1 - fx) + pixels[(rowTop + x1) * 4 + c] * fx;
      const bottom = pixels[(rowBottom + x0) * 4 + c] * (1 - fx) + pixels[(rowBottom + x1) * 4 + c] * fx;
      out[c] = top * (1 - fy) + bottom * fy;
    }
  };

  const sample = [0, 0, 0];

  const processRows = (startRow, endRow) => {
    for (let py = startRow; py < endRow; py += 1) {
      const phi = Math.PI / 2 - (py / OUTPUT_HEIGHT) * Math.PI;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const rowOffset = py * OUTPUT_WIDTH * 4;

      for (let px = 0; px < OUTPUT_WIDTH; px += 1) {
        const candidates = columnSources[px];
        if (candidates.length === 0) continue;

        const world = [cosPhi * sinTheta[px], sinPhi, cosPhi * cosTheta[px]];
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let weightSum = 0;

        for (let i = 0; i < candidates.length; i += 1) {
          const s = candidates[i];
          const frame = frames[s];
          const camera = matApply(inverse[s], world);
          if (camera[2] <= 1e-6) continue;

          const halfWidth = frame.width / 2;
          const halfHeight = frame.height / 2;
          const x = (focal * camera[0]) / camera[2] + halfWidth;
          const y = halfHeight - (focal * camera[1]) / camera[2];
          if (x < 0 || y < 0 || x >= frame.width - 1 || y >= frame.height - 1) continue;

          // Feather towards the frame edges so neighbouring frames cross-fade
          // instead of meeting at a hard line.
          const u = Math.abs(x - halfWidth) / halfWidth;
          const v = Math.abs(y - halfHeight) / halfHeight;
          const weight = (1 - u * u) * (1 - v * v);
          if (weight <= 0) continue;

          sampleBilinear(frame, x, y, sample);
          rSum += sample[0] * weight;
          gSum += sample[1] * weight;
          bSum += sample[2] * weight;
          weightSum += weight;
        }

        if (weightSum > 0) {
          const outIdx = rowOffset + px * 4;
          output[outIdx] = rSum / weightSum;
          output[outIdx + 1] = gSum / weightSum;
          output[outIdx + 2] = bSum / weightSum;
          output[outIdx + 3] = 255;
        }
      }
    }
  };

  for (let row = 0; row < OUTPUT_HEIGHT; row += ROW_CHUNK) {
    processRows(row, Math.min(row + ROW_CHUNK, OUTPUT_HEIGHT));
    onProgress?.({ stage: "projecting", percent: Math.round((row / OUTPUT_HEIGHT) * 100) });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  onProgress?.({ stage: "blending", percent: 100 });

  const outCanvas = document.createElement("canvas");
  outCanvas.width = OUTPUT_WIDTH;
  outCanvas.height = OUTPUT_HEIGHT;
  outCanvas.getContext("2d").putImageData(new ImageData(output, OUTPUT_WIDTH, OUTPUT_HEIGHT), 0, 0);

  return new Promise((resolve, reject) => {
    outCanvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Failed to encode the stitched panorama."));
    }, "image/jpeg", 0.92);
  });
}
