// Centralized, tunable guided-capture constants and pure helpers.
//
// These are guidance only — they help a person get roughly even coverage
// around a full turn and keep consecutive frames framed the same way. They do
// not guarantee overlap or alignment; image registration in the stitcher
// determines actual panorama quality. Sensor readings are advisory input to
// the person holding the phone, never an authoritative pose.

// Target count and spacing are not fixed here: they follow the camera's real
// field of view. See capture/capturePlan.ts.

/** Within this yaw error the current target counts as aligned. */
export const YAW_TOLERANCE_DEG = 6;
/** Within this yaw error the UI switches to the "almost there" state. */
export const YAW_NEAR_TOLERANCE_DEG = 18;

/** Camera elevation above/below the horizon, 0 = level. */
export const PITCH_TOLERANCE_DEG = 8;
/** Screen rotation away from upright portrait, 0 = upright. */
export const ROLL_TOLERANCE_DEG = 8;
/** Beyond these the UI escalates the tilt warning instead of nudging. */
export const PITCH_WARN_DEG = 16;
export const ROLL_WARN_DEG = 16;

/** "Steady" means total angular rate stays under this for STABILITY_WINDOW_MS. */
export const STABILITY_RATE_DEG_PER_S = 10;
export const STABILITY_WINDOW_MS = 350;

/** Ignore a second auto-capture sooner than this after the previous one. */
export const DUPLICATE_CAPTURE_GUARD_MS = 1200;
/** A new frame must be this fraction of the target spacing away from an
 * existing one. Expressed as a fraction so it scales with the plan: a fixed
 * 12° guard would swallow whole targets on a narrow-lens capture. */
export const DUPLICATE_YAW_GUARD_FRACTION = 0.4;

export const DEVICE_MOTION_UPDATE_INTERVAL_MS = 50;
/** How often the auto-capture state machine samples live orientation refs. */
export const AUTO_CAPTURE_TICK_MS = 100;

/** Roll is ill-conditioned when the camera points near straight up or down. */
export const ROLL_VALID_MAX_PITCH_DEG = 75;

/** Low-pass factor for the gravity estimate (0 = frozen, 1 = no filtering). */
export const GRAVITY_SMOOTHING = 0.25;

/** Smallest signed angular difference a - b, wrapped to (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  let diff = (a - b) % 360;
  if (diff > 180) diff -= 360;
  if (diff <= -180) diff += 360;
  return diff;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Replaces NaN/Infinity with a safe fallback. Sensor maths must never leak
 * non-finite values into alignment checks or upload metadata. */
export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export type GuidancePhase =
  | "seek" // turn further towards the target
  | "near" // almost on target
  | "tilt" // on target horizontally, but pitch/roll are off
  | "hold" // aligned, waiting for the phone to settle
  | "ready" // aligned and steady — auto capture fires here
  | "capturing"
  | "complete";

export interface OrientationSample {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  rateDegPerSec: number;
  steady: boolean;
}

export interface AlignmentState {
  phase: GuidancePhase;
  /** Signed yaw error: positive means the target is to the user's right. */
  yawErrorDeg: number;
  turn: "left" | "right" | "none";
  pitchOff: boolean;
  rollOff: boolean;
  tiltSevere: boolean;
}

/**
 * Pure alignment evaluation — no refs, no timers, no side effects, so the
 * capture state machine and the overlay always agree and this stays testable.
 */
export function evaluateAlignment(
  sample: OrientationSample,
  targetYawDeg: number | null,
  options: { capturing?: boolean; nearToleranceDeg?: number } = {},
): AlignmentState {
  if (options.capturing) {
    return { phase: "capturing", yawErrorDeg: 0, turn: "none", pitchOff: false, rollOff: false, tiltSevere: false };
  }
  if (targetYawDeg === null) {
    return { phase: "complete", yawErrorDeg: 0, turn: "none", pitchOff: false, rollOff: false, tiltSevere: false };
  }

  // The "almost there" band must stay well inside one target spacing, or on a
  // narrow-lens plan every target looks almost-aligned at once.
  const nearTolerance = Math.max(
    YAW_TOLERANCE_DEG + 2,
    Math.min(YAW_NEAR_TOLERANCE_DEG, options.nearToleranceDeg ?? YAW_NEAR_TOLERANCE_DEG),
  );

  const yawErrorDeg = angleDiffDeg(targetYawDeg, sample.yawDeg);
  const absYaw = Math.abs(yawErrorDeg);
  const absPitch = Math.abs(sample.pitchDeg);
  // Roll becomes meaningless when the camera points near the zenith/nadir.
  const rollMeasurable = absPitch < ROLL_VALID_MAX_PITCH_DEG;
  const absRoll = rollMeasurable ? Math.abs(sample.rollDeg) : 0;

  const pitchOff = absPitch > PITCH_TOLERANCE_DEG;
  const rollOff = absRoll > ROLL_TOLERANCE_DEG;
  const tiltSevere = absPitch > PITCH_WARN_DEG || absRoll > ROLL_WARN_DEG;
  const turn: AlignmentState["turn"] = absYaw <= YAW_TOLERANCE_DEG ? "none" : yawErrorDeg > 0 ? "right" : "left";

  let phase: GuidancePhase;
  if (absYaw > nearTolerance) phase = "seek";
  else if (absYaw > YAW_TOLERANCE_DEG) phase = "near";
  else if (pitchOff || rollOff) phase = "tilt";
  else if (!sample.steady) phase = "hold";
  else phase = "ready";

  return { phase, yawErrorDeg, turn, pitchOff, rollOff, tiltSevere };
}

export const PHASE_LABEL: Record<GuidancePhase, string> = {
  seek: "Turn to the next target",
  near: "Almost there",
  tilt: "Level the phone",
  hold: "Hold steady…",
  ready: "Capturing",
  capturing: "Capturing",
  complete: "Full turn covered",
};
