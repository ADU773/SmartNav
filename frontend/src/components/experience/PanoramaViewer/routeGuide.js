/**
 * SmartNav360 — AR-style route guidance inside the 360° scene.
 *
 * Draws a trail of chevrons lying flat on the floor, running from the
 * visitor's feet towards the hotspot of the next stop on their route, the way
 * Google's Live View paints arrows onto the street. The chevrons are Marzipano
 * "embedded" hotspots: each sits on a sphere around the camera and is turned
 * by CSS so that it lies in the floor plane instead of facing the camera.
 *
 * Plain DOM and maths, no React, so the geometry can be unit-tested.
 */

/** Pitch (degrees below the horizon) of each chevron, nearest first. */
export const TRAIL_PITCHES_DEG = [56, 44, 35, 28, 22, 17];
/** Never draw a chevron closer than this to the target, so the trail stops short of it. */
const GAP_BEFORE_TARGET_DEG = 7;
/** Sphere radius for embedded hotspots; larger is flatter (less perspective). */
const RADIUS = 1000;

const CHEVRON_SVG = `<svg viewBox="0 0 120 90" aria-hidden="true" focusable="false">
  <path d="M10 78 L60 22 L110 78 L84 78 L60 51 L36 78 Z" />
</svg>`;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Pitches (radians, down-positive) for the trail towards a target at
 * `targetPitch`. Chevrons stop GAP_BEFORE_TARGET_DEG short of the target, so
 * a hotspot low on the floor gets a shorter trail.
 * @param {number} targetPitch
 * @returns {number[]}
 */
export function trailPitches(targetPitch) {
  const floor = toDeg(targetPitch) + GAP_BEFORE_TARGET_DEG;
  return TRAIL_PITCHES_DEG.filter((deg) => deg > floor).map(toRad);
}

/**
 * The CSS rotation that lays an embedded hotspot at `pitch` flat on the floor.
 * An embedded hotspot faces the camera; the floor is tilted 90° - pitch away
 * from that.
 * @param {number} pitch radians, down-positive
 */
export function floorTransform(pitch) {
  return `rotateX(${(90 - toDeg(pitch)).toFixed(2)}deg)`;
}

/**
 * Signed angle (radians, -π..π) to turn from `viewYaw` to face `targetYaw`;
 * positive means turn right.
 */
export function turnAngle(viewYaw, targetYaw) {
  let delta = (targetYaw - viewYaw) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * What to tell a visitor who is facing `viewYaw`: nothing when the target is
 * roughly ahead, otherwise turn left, right or around.
 * @returns {null | "left" | "right" | "around"}
 */
export function turnHint(viewYaw, targetYaw, aheadDeg = 40) {
  const delta = toDeg(turnAngle(viewYaw, targetYaw));
  if (Math.abs(delta) <= aheadDeg) return null;
  if (Math.abs(delta) >= 150) return "around";
  return delta > 0 ? "right" : "left";
}

/**
 * Adds the floor trail to a Marzipano scene's hotspot container.
 * @param {object} container - scene.hotspotContainer()
 * @param {{ yaw: number, pitch: number }} target - the next stop's hotspot
 * @returns {() => void} removes the trail
 */
export function addFloorTrail(container, target) {
  const created = trailPitches(target.pitch).map((pitch, index, all) => {
    const element = document.createElement("div");
    element.className = "smartnav-trail";
    element.setAttribute("aria-hidden", "true");
    // Nearer chevrons are drawn larger, so the trail recedes into the scene.
    const scale = 1 - (index / Math.max(all.length, 1)) * 0.35;
    element.innerHTML = `<div class="smartnav-trail__chevron" style="--i:${index};--s:${scale.toFixed(2)}">${CHEVRON_SVG}</div>`;
    return container.createHotspot(
      element,
      { yaw: target.yaw, pitch },
      { perspective: { radius: RADIUS, extraTransforms: floorTransform(pitch) } },
    );
  });
  return () => {
    for (const hotspot of created) {
      try { container.destroyHotspot(hotspot); } catch { /* scene already destroyed */ }
    }
  };
}
