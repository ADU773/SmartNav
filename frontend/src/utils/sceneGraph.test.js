import { describe, it, expect } from 'vitest';
import { incomingCounts, linksTo, reverseDirection, unreachableScenes, wrapAngle } from './sceneGraph';

const scene = (id, targets = []) => ({ _id: id, name: id, hotspots: targets.map((t) => ({ targetScene: t })) });

describe('reverseDirection', () => {
  it('points the way back behind the visitor and keeps the height', () => {
    expect(reverseDirection({ yaw: 0, pitch: -0.1 })).toEqual({ yaw: Math.PI, pitch: -0.1 });
    expect(reverseDirection({ yaw: Math.PI / 2, pitch: 0 }).yaw).toBeCloseTo(-Math.PI / 2);
  });

  it('always lands in (-PI, PI], so pins never drift out of range', () => {
    for (const yaw of [-3, -Math.PI, -1, 0, 1, Math.PI, 3, 7, -9]) {
      const back = reverseDirection({ yaw }).yaw;
      expect(back).toBeGreaterThan(-Math.PI);
      expect(back).toBeLessThanOrEqual(Math.PI);
      // Exactly half a turn apart.
      expect(Math.abs(wrapAngle(back - yaw))).toBeCloseTo(Math.PI);
    }
  });
});

describe('graph queries', () => {
  const scenes = [scene('lobby', ['hall']), scene('hall', ['lobby', 'lab']), scene('lab'), scene('roof')];

  it('detects whether a scene links to another', () => {
    expect(linksTo(scenes[0], 'hall')).toBe(true);
    expect(linksTo(scenes[2], 'hall')).toBe(false);
  });

  it('counts incoming links', () => {
    const counts = incomingCounts(scenes);
    expect(Object.fromEntries(counts)).toEqual({ lobby: 1, hall: 1, lab: 1, roof: 0 });
  });

  it('finds scenes a visitor cannot reach from the first scene', () => {
    expect(unreachableScenes(scenes).map((s) => s._id)).toEqual(['roof']);
    expect(unreachableScenes([scene('only')])).toEqual([]);
  });

  it('ignores hotspots pointing at deleted scenes', () => {
    expect(unreachableScenes([scene('a', ['ghost']), scene('b')]).map((s) => s._id)).toEqual(['b']);
  });
});
