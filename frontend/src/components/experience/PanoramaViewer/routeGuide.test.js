import { describe, expect, it } from 'vitest';
import { TRAIL_PITCHES_DEG, floorTransform, trailPitches, turnAngle, turnHint } from './routeGuide';

const rad = (deg) => (deg * Math.PI) / 180;

describe('route guide', () => {
  it('runs the floor trail from the feet towards a doorway on the horizon', () => {
    const pitches = trailPitches(rad(0));
    expect(pitches).toHaveLength(TRAIL_PITCHES_DEG.length);
    // Nearest first: each chevron is further away, so closer to the horizon.
    for (let i = 1; i < pitches.length; i += 1) expect(pitches[i]).toBeLessThan(pitches[i - 1]);
  });

  it('stops the trail short of a hotspot that is low on the floor', () => {
    const pitches = trailPitches(rad(30));
    expect(pitches.length).toBeGreaterThan(0);
    expect(Math.min(...pitches)).toBeGreaterThan(rad(37));
    // A hotspot at the feet leaves no room for a trail.
    expect(trailPitches(rad(60))).toEqual([]);
  });

  it('lays a chevron flat: the steeper it is below the horizon, the less it is tilted', () => {
    expect(floorTransform(rad(30))).toBe('rotateX(60.00deg)');
    expect(floorTransform(rad(56))).toBe('rotateX(34.00deg)');
  });

  it('turns the short way round, across the ±180° seam', () => {
    expect(turnAngle(rad(170), rad(-170))).toBeCloseTo(rad(20));
    expect(turnAngle(rad(-170), rad(170))).toBeCloseTo(rad(-20));
    expect(turnAngle(0, rad(90))).toBeCloseTo(rad(90));
  });

  it('only asks the visitor to turn when the next stop is off to the side or behind', () => {
    expect(turnHint(0, rad(25))).toBeNull();
    expect(turnHint(0, rad(80))).toBe('right');
    expect(turnHint(0, rad(-80))).toBe('left');
    expect(turnHint(0, rad(175))).toBe('around');
    expect(turnHint(rad(350), rad(10))).toBeNull();
  });
});
