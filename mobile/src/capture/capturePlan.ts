/**
 * SmartNav360 — Capture geometry planner
 *
 * How many frames to take, and how far apart, follows from one thing: how much
 * of the world the lens actually sees. Hard-coding 12 targets at 30° is right
 * only for a camera with roughly a 54° horizontal field of view. Give the same
 * plan to a narrower capture and neighbouring frames stop overlapping enough
 * for the stitcher to register them — which is exactly what a screen-shaped
 * crop produced: 35° of view at 30° spacing left about 6° of overlap, and two
 * of three pairs failed to register.
 *
 * So the plan is derived from the frame's real aspect ratio instead, aiming at
 * a fixed overlap fraction. A normal 4:3 capture lands back on 12 targets at
 * 30°; a narrower one automatically takes more frames closer together.
 */

/** Overlap between neighbouring frames, as a fraction of frame width. */
export const TARGET_OVERLAP_FRACTION = 0.45;
/** Guard rails on the resulting plan. */
export const MIN_TARGET_COUNT = 8;
export const MAX_TARGET_COUNT = 36;

/**
 * Field of view across the *longer* image axis for a typical phone wide
 * camera (around a 26 mm equivalent). Only a seed for planning: the stitcher
 * measures the real value from the photographs afterwards.
 */
export const LONG_AXIS_FOV_DEG = 69;

/** The aspect a full-sensor portrait frame should have. */
export const NATIVE_PORTRAIT_ASPECT = 3 / 4;
/** Below this, a portrait frame is not the full sensor frame. */
export const CROPPED_ASPECT_LIMIT = 0.68;

const DEG = Math.PI / 180;

/**
 * Horizontal field of view implied by a frame's pixel dimensions.
 *
 * The focal length is derived from the longer axis, then the horizontal angle
 * is read back out of it. That way a portrait frame and a landscape frame of
 * the same camera agree, and a frame that has been cropped along one axis
 * reports the narrower angle it genuinely covers.
 */
export function estimateHfovDeg(width: number, height: number): number {
  const longAxis = Math.max(width, height);
  if (!longAxis || !width) return LONG_AXIS_FOV_DEG;
  const focal = longAxis / 2 / Math.tan((LONG_AXIS_FOV_DEG * DEG) / 2);
  return (2 * Math.atan(width / 2 / focal)) / DEG;
}

export interface CapturePlan {
  /** Horizontal field of view the plan was built for. */
  hfovDeg: number;
  targetCount: number;
  spacingDeg: number;
  /** Overlap between neighbouring frames. */
  overlapDeg: number;
  overlapFraction: number;
  /** Aspect (width / height) the plan was derived from, when known. */
  aspect: number | null;
  /** True when the frame looks cropped rather than full-sensor. */
  cropped: boolean;
}

/**
 * Chooses a target count and spacing for a given horizontal field of view.
 *
 * Targets are evenly spaced around the full turn, so the count has to be a
 * whole number; the spacing is recomputed from the rounded count rather than
 * the other way round, which keeps the last frame meeting the first.
 */
export function planCapture(hfovDeg: number, aspect: number | null = null): CapturePlan {
  const safeHfov = Number.isFinite(hfovDeg) && hfovDeg > 5 ? hfovDeg : LONG_AXIS_FOV_DEG;
  const desiredSpacing = safeHfov * (1 - TARGET_OVERLAP_FRACTION);
  const rawCount = 360 / desiredSpacing;
  const targetCount = Math.min(MAX_TARGET_COUNT, Math.max(MIN_TARGET_COUNT, Math.round(rawCount)));
  const spacingDeg = 360 / targetCount;
  const overlapDeg = safeHfov - spacingDeg;

  return {
    hfovDeg: safeHfov,
    targetCount,
    spacingDeg,
    overlapDeg,
    overlapFraction: overlapDeg / safeHfov,
    aspect,
    cropped: aspect !== null && aspect < CROPPED_ASPECT_LIMIT,
  };
}

/** Plan for a frame of the given pixel size. */
export function planFromFrameSize(width: number, height: number): CapturePlan {
  const portraitWidth = Math.min(width, height);
  const portraitHeight = Math.max(width, height);
  return planCapture(estimateHfovDeg(width, height), portraitWidth / portraitHeight);
}

/**
 * The plan assumed before the camera has reported anything: a full-sensor 4:3
 * portrait frame, which works out to 12 targets 30° apart — the workflow the
 * briefing describes.
 */
export const DEFAULT_CAPTURE_PLAN: CapturePlan = planFromFrameSize(3, 4);

/** Evenly spaced target yaw angles for a plan. */
export function targetYawsDeg(targetCount: number): number[] {
  const spacing = 360 / targetCount;
  return Array.from({ length: targetCount }, (_, i) => i * spacing);
}

export function describePlan(plan: CapturePlan): string {
  return `${plan.targetCount} shots, ${plan.spacingDeg.toFixed(
    0,
  )}° apart, ${(plan.overlapFraction * 100).toFixed(0)}% overlap (${plan.hfovDeg.toFixed(0)}° lens)`;
}
