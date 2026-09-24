/**
 * SmartNav360 — Sensor-assisted image registration for panorama frames
 *
 * Phone sensors say roughly where each frame points. Roughly is not enough:
 * an error of a couple of degrees, or a focal length off by ten percent,
 * doubles every edge in the overlap. So the sensors only initialise the
 * problem here, and overlapping image content decides the final placement.
 *
 * Pipeline per adjacent pair:
 *   sensor yaw/pitch/roll -> expected overlap band -> ORB matches inside that
 *   band -> ratio test -> RANSAC over a rotation-only model -> relative
 *   rotation. Pairs are then chained into absolute orientations, a single
 *   focal length is refined against all inlier correspondences, and any
 *   loop-closure error is spread evenly around the circle.
 *
 * This module holds no DOM or OpenCV code; it consumes match lists.
 */

import {
  DEG,
  angleBetween,
  axisAngleToRotation,
  fitRotation,
  fitRotationRansac,
  matApply,
  matMul,
  matTranspose,
  pixelToRay,
  rotationFromYawPitchRoll,
  rotationToAxisAngle,
  yawPitchRollFromRotation,
} from "./rotation.js";

/** Minimum RANSAC inliers before a pair's measured rotation is trusted. */
export const MIN_PAIR_INLIERS = 12;
/** Inlier threshold for the rotation model. */
export const RANSAC_THRESHOLD_RAD = 1.5 * DEG;
export const RANSAC_ITERATIONS = 600;
/** A measured rotation this far from the sensor estimate is not believable. */
export const MAX_SENSOR_DISAGREEMENT_RAD = 25 * DEG;
/**
 * How far outside frame A's rectangle a back-projected match may still land
 * and be kept, as a fraction of the frame size. Generous on purpose: the
 * overlap test runs with a focal length that is itself only an estimate.
 */
export const OVERLAP_MARGIN_FRACTION = 0.35;
/**
 * Bounds for focal-length self-calibration, relative to the initial estimate.
 *
 * Wide on purpose. A phone that returns a screen-aspect crop rather than the
 * full sensor frame moves the true focal length by more than a third — the
 * earlier 0.7-1.4 window could not reach the answer from such a start, so
 * calibration silently converged on its own bad initial guess.
 */
export const FOCAL_SEARCH_MIN = 0.4;
export const FOCAL_SEARCH_MAX = 2.5;
/** Total inliers needed before focal refinement is attempted at all. */
export const MIN_INLIERS_FOR_FOCAL = 40;
/** Fraction of reprojection errors kept when averaging (the rest are the tail). */
export const FOCAL_TRIM_FRACTION = 0.8;
/** Below this relative gain, the starting estimate is kept. */
export const MIN_FOCAL_IMPROVEMENT = 0.05;
/**
 * How far the calibrated focal length may stray from the camera prior on an
 * ordinary improvement. Beyond it, only a large error reduction is convincing.
 * Set wide enough to still cross a screen-shaped crop (a scale of about 0.62).
 */
export const FOCAL_PRIOR_SCALE_LIMIT = 1.8;
export const FOCAL_STRONG_IMPROVEMENT = 0.5;
/** A calibrated lens must leave at least this much overlap on pairs that the
 * matcher has already proven overlap. */
export const MIN_CALIBRATED_OVERLAP_DEG = 5;
/** Loop closure is only attempted when the frames really do span a full turn. */
export const LOOP_CLOSURE_MIN_SPAN_DEG = 300;

/**
 * Builds the sensor-derived camera-to-world rotation for a frame. Frames with
 * no metadata (browser captures) are assumed evenly spaced around a full turn.
 */
export function sensorRotation(frame, index, total) {
  const yaw = typeof frame.yawDeg === "number" ? frame.yawDeg : (index * 360) / total;
  const pitch = typeof frame.pitchDeg === "number" ? frame.pitchDeg : 0;
  const roll = typeof frame.rollDeg === "number" ? frame.rollDeg : 0;
  return rotationFromYawPitchRoll(yaw * DEG, pitch * DEG, roll * DEG);
}

/**
 * Keeps only matches that the sensor estimate says could plausibly be the same
 * world point: frame B's ray, rotated into frame A, must land near frame A's
 * image rectangle.
 *
 * This is a rectangle test rather than a cone test. A cone of the *horizontal*
 * half-FOV throws away the top and bottom of a portrait frame, which on a tall
 * phone capture is most of the image — the first version of this filter did
 * exactly that, discarding good correspondences before RANSAC ever saw them.
 *
 * It is also skipped entirely on the first registration pass: the mask is
 * derived from a focal length that has not been calibrated yet, so letting it
 * run first can prevent the very calibration that would make it correct.
 */
function filterToExpectedOverlap(matches, relativeSensorRotation, frameA, focal) {
  const halfWidth = frameA.width / 2;
  const halfHeight = frameA.height / 2;
  const marginX = frameA.width * OVERLAP_MARGIN_FRACTION;
  const marginY = frameA.height * OVERLAP_MARGIN_FRACTION;

  return matches.filter((match) => {
    const projected = matApply(relativeSensorRotation, match.rayTo);
    if (projected[2] <= 1e-6) return false;
    const x = (focal * projected[0]) / projected[2] + halfWidth;
    const y = halfHeight - (focal * projected[1]) / projected[2];
    return x >= -marginX && y >= -marginY && x <= frameA.width + marginX && y <= frameA.height + marginY;
  });
}

/**
 * Converts raw pixel matches into camera rays for a given focal length.
 * @param {{x1:number,y1:number,x2:number,y2:number}[]} pixelMatches
 */
export function matchesToRays(pixelMatches, frameA, frameB, focal) {
  return pixelMatches.map((match) => ({
    rayFrom: pixelToRay(match.x1, match.y1, frameA.width / 2, frameA.height / 2, focal),
    rayTo: pixelToRay(match.x2, match.y2, frameB.width / 2, frameB.height / 2, focal),
  }));
}

/**
 * Estimates the rotation taking frame B's camera coordinates into frame A's.
 *
 * Every return carries a `stats` block, including the failures. A pair that
 * falls back to the sensors is only actionable if you can see *where* it fell
 * back — too few descriptor matches means the frames barely overlap, while
 * plenty of matches and no RANSAC consensus means they overlap but the
 * geometry model is wrong.
 *
 * @param {object} [options]
 * @param {boolean} [options.overlapCheck] - apply the sensor-derived overlap
 *   mask. Left off for the first pass, before the focal length is calibrated.
 */
export function estimatePairRotation(pixelMatches, frameA, frameB, focal, sensorRelative, options = {}) {
  const {
    overlapCheck = false,
    maxDisagreementRad = MAX_SENSOR_DISAGREEMENT_RAD,
    minInliers = MIN_PAIR_INLIERS,
  } = options;

  const stats = {
    descriptorMatches: pixelMatches.length,
    consideredMatches: pixelMatches.length,
    inliers: 0,
    medianErrorDeg: null,
    disagreementDeg: null,
    overlapCheck,
  };

  const sensorResult = (reason) => ({
    rotation: sensorRelative,
    inlierMatches: [],
    medianErrorRad: null,
    source: "sensor",
    reason,
    stats,
  });

  if (pixelMatches.length < minInliers) {
    return sensorResult(`only ${pixelMatches.length} descriptor matches survived the ratio test`);
  }

  const rays = matchesToRays(pixelMatches, frameA, frameB, focal);
  const withPixels = rays.map((ray, i) => ({ ...ray, pixels: pixelMatches[i] }));
  const candidates = overlapCheck
    ? filterToExpectedOverlap(withPixels, sensorRelative, frameA, focal)
    : withPixels;
  stats.consideredMatches = candidates.length;

  if (candidates.length < minInliers) {
    return sensorResult(`only ${candidates.length} of ${pixelMatches.length} matches fell inside the expected overlap`);
  }

  const result = fitRotationRansac(
    candidates.map((c) => c.rayTo),
    candidates.map((c) => c.rayFrom),
    { threshold: RANSAC_THRESHOLD_RAD, iterations: RANSAC_ITERATIONS, minInliers },
  );
  if (!result) {
    return sensorResult(`no consistent rotation among ${candidates.length} matches (need ${minInliers} agreeing)`);
  }

  stats.inliers = result.inliers.length;
  stats.medianErrorDeg = result.medianErrorRad / DEG;

  // Guard against a confident fit on repeated structure (railings, tiling,
  // rows of windows), which can agree internally while being a whole target
  // spacing away from where the phone says the frame points.
  const disagreement = angleBetween(
    matApply(result.rotation, [0, 0, 1]),
    matApply(sensorRelative, [0, 0, 1]),
  );
  stats.disagreementDeg = disagreement / DEG;
  if (disagreement > maxDisagreementRad) {
    return sensorResult(
      `${result.inliers.length} inliers agreed, but ${(disagreement / DEG).toFixed(1)}° away from the sensor estimate`,
    );
  }

  return {
    rotation: result.rotation,
    inlierMatches: result.inliers.map((i) => candidates[i]),
    medianErrorRad: result.medianErrorRad,
    source: "image",
    stats,
  };
}

/**
 * Refines one focal length shared by every frame.
 *
 * The objective is **pixel reprojection error**, not angular ray error, and
 * that distinction is the whole point of this function.
 *
 * Measuring the angle between a rotated ray and its match looks reasonable but
 * is degenerate. Rays are `normalize([x - cx, -(y - cy), f])`, so as the focal
 * length grows every ray converges on the optical axis and the angular spread
 * of the whole field shrinks like 1/f. Any error measured inside that field
 * shrinks with it. Past a certain focal length the objective falls
 * monotonically forever, and the optimiser wins by collapsing the camera model
 * rather than by explaining the photographs. On a real capture that drove the
 * estimate to a 16.5° field of view for frames taken 29.7° apart —
 * geometrically impossible, because those frames shared hundreds of confirmed
 * correspondences and therefore must overlap.
 *
 * Projecting back into frame A's pixels removes the escape route. A collapsed
 * ray field still has to reproduce the perspective foreshortening between two
 * frames tens of degrees apart, and a near-orthographic model cannot, so its
 * pixel error stays large. The minimum then sits at the true focal length.
 *
 * The answer is checked for physical plausibility before it is adopted — see
 * validateFocal — because a lower residual is not on its own evidence of a
 * better camera.
 *
 * @returns {{ focal: number, refined: boolean, reason: string,
 *   baselineErrorPx: number|null, bestErrorPx: number|null, scale: number }}
 */
export function refineFocalLength(pairs, initialFocal) {
  const usable = pairs.filter((pair) => pair.source === "image" && pair.inlierMatches.length >= 8);
  const totalInliers = usable.reduce((sum, pair) => sum + pair.inlierMatches.length, 0);
  const unrefined = (reason) => ({
    focal: initialFocal,
    refined: false,
    reason,
    baselineErrorPx: null,
    bestErrorPx: null,
    scale: 1,
  });

  if (totalInliers < MIN_INLIERS_FOR_FOCAL) {
    return unrefined(`only ${totalInliers} inliers across all pairs; ${MIN_INLIERS_FOR_FOCAL} needed`);
  }

  const baseline = scoreFocal(usable, initialFocal);
  if (!baseline) return unrefined("could not evaluate the starting focal length");

  // Coarse scan first. The pixel objective is well shaped but not guaranteed
  // convex over this range, so a purely local search could settle in a dip.
  let best = { focal: initialFocal, score: baseline };
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const scale = FOCAL_SEARCH_MIN + ((FOCAL_SEARCH_MAX - FOCAL_SEARCH_MIN) * i) / steps;
    const focal = initialFocal * scale;
    const score = scoreFocal(usable, focal);
    if (score && score.errorPx < best.score.errorPx) best = { focal, score };
  }

  // Local refinement, clamped to the same bounds. An unclamped version of this
  // loop is what let the earlier estimate walk out to 3.55x the starting focal
  // length — far past the range the coarse scan was ever allowed to consider.
  const lowerFocal = initialFocal * FOCAL_SEARCH_MIN;
  const upperFocal = initialFocal * FOCAL_SEARCH_MAX;
  let span = (initialFocal * (FOCAL_SEARCH_MAX - FOCAL_SEARCH_MIN)) / steps;
  for (let round = 0; round < 16; round += 1) {
    const candidates = [best.focal - span, best.focal + span].filter(
      (focal) => focal >= lowerFocal && focal <= upperFocal,
    );
    let improved = false;
    for (const focal of candidates) {
      const score = scoreFocal(usable, focal);
      if (score && score.errorPx < best.score.errorPx) {
        best = { focal, score };
        improved = true;
        break;
      }
    }
    if (!improved) span /= 2;
  }

  return validateFocal({ initialFocal, baseline, best });
}

/**
 * Mean pixel reprojection error over the trusted correspondences, plus the
 * angular separation each pair implies at this focal length.
 *
 * Only RANSAC inliers are scored, and the mean is trimmed so a few survivors
 * sitting on repeated structure cannot steer the calibration.
 */
function scoreFocal(usable, focal) {
  const errors = [];
  const separations = [];

  for (const pair of usable) {
    const from = [];
    const to = [];
    for (const match of pair.inlierMatches) {
      const { x1, y1, x2, y2 } = match.pixels;
      to.push(pixelToRay(x1, y1, pair.frameA.width / 2, pair.frameA.height / 2, focal));
      from.push(pixelToRay(x2, y2, pair.frameB.width / 2, pair.frameB.height / 2, focal));
    }
    const rotation = fitRotation(from, to);
    if (!rotation) return null;
    separations.push({
      pair,
      separationRad: angleBetween(matApply(rotation, [0, 0, 1]), [0, 0, 1]),
    });

    const halfWidth = pair.frameA.width / 2;
    const halfHeight = pair.frameA.height / 2;
    for (let i = 0; i < from.length; i += 1) {
      const rotated = matApply(rotation, from[i]);
      if (rotated[2] <= 1e-6) return null;
      const x = (focal * rotated[0]) / rotated[2] + halfWidth;
      const y = halfHeight - (focal * rotated[1]) / rotated[2];
      const { x1, y1 } = pair.inlierMatches[i].pixels;
      errors.push(Math.hypot(x - x1, y - y1));
    }
  }

  if (errors.length === 0) return null;
  errors.sort((a, b) => a - b);
  const keep = Math.max(1, Math.floor(errors.length * FOCAL_TRIM_FRACTION));
  const errorPx = errors.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep;
  return { errorPx, separations };
}

/**
 * Decides whether a calibrated focal length is believable enough to adopt.
 *
 * A smaller reprojection error is necessary but not sufficient. Two further
 * things must hold: the answer stays near the camera prior unless the pixels
 * argue strongly otherwise, and it must not imply a camera too narrow to have
 * seen what the matcher demonstrably found.
 */
function validateFocal({ initialFocal, baseline, best }) {
  const scale = best.focal / initialFocal;
  const keepInitial = (reason) => ({
    focal: initialFocal,
    refined: false,
    reason,
    baselineErrorPx: baseline.errorPx,
    bestErrorPx: best.score.errorPx,
    scale: 1,
  });

  const improvement = baseline.errorPx > 0 ? 1 - best.score.errorPx / baseline.errorPx : 0;
  if (improvement < MIN_FOCAL_IMPROVEMENT) {
    return keepInitial(
      `no meaningful improvement on the starting estimate (${baseline.errorPx.toFixed(2)}px vs ${best.score.errorPx.toFixed(2)}px)`,
    );
  }

  const departure = Math.max(scale, 1 / scale);
  if (departure > FOCAL_PRIOR_SCALE_LIMIT && improvement < FOCAL_STRONG_IMPROVEMENT) {
    return keepInitial(
      `wanted ${scale.toFixed(2)}x the expected focal length on only a ${(improvement * 100).toFixed(0)}% error reduction`,
    );
  }

  // Overlap consistency. A pair with many inliers has been *observed* to share
  // image content, so a focal length implying those two frames cannot see the
  // same thing is wrong however low its residual.
  for (const entry of best.score.separations) {
    if (entry.pair.inlierMatches.length < MIN_PAIR_INLIERS) continue;
    const hfovRad = 2 * Math.atan(entry.pair.frameA.width / 2 / best.focal);
    if (hfovRad - entry.separationRad < MIN_CALIBRATED_OVERLAP_DEG * DEG) {
      return keepInitial(
        `implied ${(hfovRad / DEG).toFixed(1)}° lens cannot overlap frames ${(entry.separationRad / DEG).toFixed(1)}° apart, yet they share ${entry.pair.inlierMatches.length} confirmed features`,
      );
    }
  }

  return {
    focal: best.focal,
    refined: true,
    reason: `reprojection error ${baseline.errorPx.toFixed(2)}px to ${best.score.errorPx.toFixed(2)}px`,
    baselineErrorPx: baseline.errorPx,
    bestErrorPx: best.score.errorPx,
    scale,
  };
}

/**
 * Chains relative rotations into absolute camera-to-world rotations, anchored
 * on the first frame's sensor orientation so the panorama keeps roughly the
 * heading it was shot at.
 */
export function chainRotations(firstRotation, pairRotations) {
  const rotations = [firstRotation];
  for (const relative of pairRotations) {
    rotations.push(matMul(rotations[rotations.length - 1], relative));
  }
  return rotations;
}

/**
 * Spreads loop-closure error evenly around the circle.
 *
 * Chaining eleven pairwise rotations accumulates the error of all eleven, so
 * the last frame rarely meets the first exactly — the seam lands somewhere
 * near 330°. Measuring the closing pair gives the total error; rotating frame
 * k backwards by k/n of it hides the seam by sharing it between every frame,
 * where each share is small enough that feature blending absorbs it.
 *
 * This is a global correction, not full bundle adjustment: it removes the
 * visible seam without re-optimising every frame against every other.
 *
 * @param {number[][]} rotations - absolute rotations, first frame anchored.
 * @param {number[]|null} closingRotation - measured rotation from the last
 *   frame's camera into the first frame's camera, or null if unmeasured.
 * @returns {{ rotations: number[][], appliedDeg: number }}
 */
export function applyLoopClosure(rotations, closingRotation) {
  if (!closingRotation || rotations.length < 3) return { rotations, appliedDeg: 0 };

  const count = rotations.length;
  const last = rotations[count - 1];
  const first = rotations[0];
  // Where the closing match says the first frame is, versus where chaining put it.
  const predictedFirst = matMul(last, closingRotation);
  const error = matMul(matTranspose(first), predictedFirst);
  const { axis, angle } = rotationToAxisAngle(error);
  if (!Number.isFinite(angle) || angle < 0.05 * DEG) return { rotations, appliedDeg: 0 };

  const corrected = rotations.map((rotation, index) => {
    const share = (index / count) * angle;
    return matMul(axisAngleToRotation(axis, -share), rotation);
  });
  return { rotations: corrected, appliedDeg: angle / DEG };
}

/** Human-readable placement summary, used for the stitch report. */
export function describePlacement(rotations) {
  return rotations.map((rotation) => {
    const { yaw, pitch, roll } = yawPitchRollFromRotation(rotation);
    return { yawDeg: yaw / DEG, pitchDeg: pitch / DEG, rollDeg: roll / DEG };
  });
}

/** Total yaw travelled across the chain, used to decide if the turn closed. */
export function yawSpanDeg(rotations) {
  let span = 0;
  for (let i = 1; i < rotations.length; i += 1) {
    const previous = yawPitchRollFromRotation(rotations[i - 1]).yaw;
    const current = yawPitchRollFromRotation(rotations[i]).yaw;
    let delta = (current - previous) % (2 * Math.PI);
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta <= -Math.PI) delta += 2 * Math.PI;
    span += delta;
  }
  return Math.abs(span / DEG);
}
