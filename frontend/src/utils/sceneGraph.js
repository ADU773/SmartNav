/**
 * SmartNav360 — Scene graph helpers for the Hotspot Builder
 *
 * Scenes are nodes and hotspots are directed edges (scene -> targetScene).
 * These helpers answer the questions the editor needs without any React.
 */

/** Wraps an angle in radians into (-PI, PI]. */
export function wrapAngle(angle) {
  let wrapped = angle % (2 * Math.PI);
  if (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
  if (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  return wrapped;
}

/**
 * Where to place the pin for the way back.
 *
 * If you walk through a doorway facing a given direction, the way back is
 * behind you once you arrive: the opposite yaw. Pitch is kept, because the
 * doorway you return through sits at roughly the same height. This is a
 * sensible first guess, not a measurement — the editor lets you move it.
 */
export function reverseDirection({ yaw = 0, pitch = 0 } = {}) {
  return { yaw: wrapAngle(yaw + Math.PI), pitch };
}

/** Whether `fromScene` has a hotspot leading to `toSceneId`. */
export function linksTo(fromScene, toSceneId) {
  return !!fromScene?.hotspots?.some((spot) => String(spot.targetScene) === String(toSceneId));
}

/**
 * Incoming-link count per scene ID.
 * @returns {Map<string, number>}
 */
export function incomingCounts(scenes = []) {
  const counts = new Map(scenes.map((scene) => [String(scene._id), 0]));
  for (const scene of scenes) {
    for (const spot of scene.hotspots || []) {
      const id = String(spot.targetScene);
      if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
  }
  return counts;
}

/**
 * Scenes a visitor cannot reach from the first scene by following hotspots.
 * Returns an empty list when there are fewer than two scenes, since a single
 * scene is trivially complete.
 */
export function unreachableScenes(scenes = []) {
  if (scenes.length < 2) return [];
  const byId = new Map(scenes.map((scene) => [String(scene._id), scene]));
  const start = String(scenes[0]._id);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const scene = byId.get(queue.shift());
    for (const spot of scene?.hotspots || []) {
      const id = String(spot.targetScene);
      if (byId.has(id) && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
  }
  return scenes.filter((scene) => !seen.has(String(scene._id)));
}
