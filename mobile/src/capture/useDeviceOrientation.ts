import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { DeviceMotion, DeviceMotionMeasurement } from "expo-sensors";
import {
  clamp,
  finiteOr,
  DEVICE_MOTION_UPDATE_INTERVAL_MS,
  GRAVITY_SMOOTHING,
  STABILITY_RATE_DEG_PER_S,
  STABILITY_WINDOW_MS,
} from "./guidance";
import type { OrientationSample } from "./guidance";

export interface Orientation extends OrientationSample {
  available: boolean;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Orientation model
 * -----------------
 * Tilt (pitch/roll) comes from the gravity vector, never from Euler angles.
 * On iOS `rotation` is CMAttitude (alpha=yaw, beta=pitch, gamma=roll), whose
 * Euler decomposition is degenerate at pitch ±90° — exactly the pose used to
 * shoot a panorama — so both yaw and roll become unstable there. Gravity has
 * no such singularity and is absolute: "level" means level, not "however the
 * phone happened to be held when this screen mounted".
 *
 * Yaw is integrated from the gyroscope component about the vertical (gravity)
 * axis. It is relative to wherever capture started and drifts slowly, which is
 * fine for guidance; it is not used for image alignment.
 *
 * Axis conventions (device frame: x = right, y = top of screen, z = out of the
 * screen towards the user; the rear camera looks along -z):
 *  - expo-sensors reports `accelerationIncludingGravity` pointing DOWN on both
 *    platforms (iOS: (userAcceleration + CMDeviceMotion.gravity) * g;
 *    Android: accelerometer - 2 * gravity).
 *  - `rotationRate` is in degrees/second, but the component order differs:
 *    iOS maps alpha/beta/gamma to gyro z/y/x, Android maps them to x/y/z.
 */
function rotationRateToDeviceAxes(rate: { alpha: number; beta: number; gamma: number }) {
  if (Platform.OS === "ios") {
    return { x: rate.gamma, y: rate.beta, z: rate.alpha };
  }
  return { x: rate.alpha, y: rate.beta, z: rate.gamma };
}

const IDLE: Orientation = {
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  rateDegPerSec: 0,
  steady: false,
  available: true,
};

/**
 * Tracks device orientation for guided capture.
 *
 * Returns both React state (for rendering) and a ref holding the newest
 * sample. The auto-capture state machine reads the ref so it can never act on
 * a stale render; the overlay reads state so it re-renders normally.
 */
export function useDeviceOrientation(enabled: boolean) {
  const [state, setState] = useState<Orientation>(IDLE);
  const latestRef = useRef<Orientation>(IDLE);

  const gravityRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const yawRef = useRef(0);
  const lastSampleAtRef = useRef<number | null>(null);
  const steadySinceRef = useRef<number | null>(null);
  // Fallback path only: unwrapping CMAttitude yaw when no gyroscope is present.
  const lastAlphaRef = useRef<number | null>(null);

  /** Re-zeros relative yaw (used when capture restarts). */
  const resetYaw = useCallback(() => {
    yawRef.current = 0;
    lastAlphaRef.current = null;
    steadySinceRef.current = null;
    latestRef.current = { ...latestRef.current, yawDeg: 0 };
    setState((previous) => ({ ...previous, yawDeg: 0 }));
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    gravityRef.current = null;
    yawRef.current = 0;
    lastSampleAtRef.current = null;
    steadySinceRef.current = null;
    lastAlphaRef.current = null;

    let cancelled = false;
    DeviceMotion.isAvailableAsync()
      .then((available) => {
        if (cancelled || available) return;
        setState((s) => ({ ...s, available: false }));
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, available: false }));
      });

    DeviceMotion.setUpdateInterval(DEVICE_MOTION_UPDATE_INTERVAL_MS);

    const handle = (measurement: DeviceMotionMeasurement) => {
      const now = Date.now();
      const dtSeconds = lastSampleAtRef.current === null
        ? DEVICE_MOTION_UPDATE_INTERVAL_MS / 1000
        : clamp((now - lastSampleAtRef.current) / 1000, 0.001, 0.5);
      lastSampleAtRef.current = now;

      // ---- Tilt from gravity ------------------------------------------------
      const raw = measurement.accelerationIncludingGravity;
      if (raw) {
        const x = finiteOr(raw.x, 0);
        const y = finiteOr(raw.y, 0);
        const z = finiteOr(raw.z, 0);
        const magnitude = Math.hypot(x, y, z);
        if (magnitude > 0.5) {
          const sample = { x: x / magnitude, y: y / magnitude, z: z / magnitude };
          const previous = gravityRef.current;
          gravityRef.current = previous
            ? {
                x: previous.x + (sample.x - previous.x) * GRAVITY_SMOOTHING,
                y: previous.y + (sample.y - previous.y) * GRAVITY_SMOOTHING,
                z: previous.z + (sample.z - previous.z) * GRAVITY_SMOOTHING,
              }
            : sample;
        }
      }

      const down = gravityRef.current;
      let pitchDeg = latestRef.current.pitchDeg;
      let rollDeg = latestRef.current.rollDeg;
      if (down) {
        const magnitude = Math.hypot(down.x, down.y, down.z) || 1;
        const dx = down.x / magnitude;
        const dy = down.y / magnitude;
        const dz = down.z / magnitude;
        // Camera axis (0,0,-1) elevation above the horizon: sin(elev) = dz.
        // Upright & level -> dz = 0; camera at the zenith -> dz = +1.
        pitchDeg = Math.asin(clamp(dz, -1, 1)) * RAD_TO_DEG;
        // Screen rotation away from upright portrait, from the "up" vector -d.
        rollDeg = Math.atan2(dx, -dy) * RAD_TO_DEG;
      }

      // ---- Yaw from the gyroscope about the vertical axis --------------------
      let rateDegPerSec = latestRef.current.rateDegPerSec;
      const rate = measurement.rotationRate;
      if (rate && down) {
        const omega = rotationRateToDeviceAxes({
          alpha: finiteOr(rate.alpha, 0),
          beta: finiteOr(rate.beta, 0),
          gamma: finiteOr(rate.gamma, 0),
        });
        const magnitude = Math.hypot(down.x, down.y, down.z) || 1;
        // Rotation rate about the downward vertical. By the right-hand rule
        // that is positive when the user turns to their right, so yaw grows
        // clockwise — matching targets laid out at 0°, 30°, 60° …
        const yawRateDegPerSec = (omega.x * down.x + omega.y * down.y + omega.z * down.z) / magnitude;
        yawRef.current += yawRateDegPerSec * dtSeconds;
        rateDegPerSec = Math.hypot(omega.x, omega.y, omega.z);
      } else if (measurement.rotation) {
        // No gyroscope: fall back to unwrapping CMAttitude yaw. Degenerate near
        // pitch ±90°, so this is a last resort, not the primary path.
        const alphaDeg = finiteOr(measurement.rotation.alpha, 0) * RAD_TO_DEG;
        if (lastAlphaRef.current !== null) {
          let delta = (alphaDeg - lastAlphaRef.current) % 360;
          if (delta > 180) delta -= 360;
          if (delta <= -180) delta += 360;
          yawRef.current += delta;
          rateDegPerSec = Math.abs(delta) / dtSeconds;
        }
        lastAlphaRef.current = alphaDeg;
      }

      // ---- Steadiness --------------------------------------------------------
      if (rateDegPerSec < STABILITY_RATE_DEG_PER_S) {
        if (steadySinceRef.current === null) steadySinceRef.current = now;
      } else {
        steadySinceRef.current = null;
      }
      const steady = steadySinceRef.current !== null && now - steadySinceRef.current >= STABILITY_WINDOW_MS;

      const next: Orientation = {
        yawDeg: finiteOr(yawRef.current, 0),
        pitchDeg: finiteOr(pitchDeg, 0),
        rollDeg: finiteOr(rollDeg, 0),
        rateDegPerSec: finiteOr(rateDegPerSec, 0),
        steady,
        available: latestRef.current.available,
      };
      latestRef.current = next;
      setState(next);
    };

    const subscription = DeviceMotion.addListener(handle);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [enabled]);

  useEffect(() => {
    latestRef.current = { ...latestRef.current, available: state.available };
  }, [state.available]);

  return { orientation: state, orientationRef: latestRef, resetYaw };
}
