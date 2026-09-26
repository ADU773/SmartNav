import { describe, expect, it } from 'vitest';
import { groupDetections, nextDetection } from './detections';

const chair = (confidence, yawDeg) => ({ label: 'chair', confidence, yawDeg, pitchDeg: 10 });

describe('groupDetections', () => {
  it('counts each label, most common first, clearest example first', () => {
    const groups = groupDetections([
      chair(0.5, 10),
      { label: 'laptop', confidence: 0.9, yawDeg: 40, pitchDeg: 5 },
      chair(0.8, 120),
      { label: 'bottle', confidence: 0.7, yawDeg: -60, pitchDeg: 20 },
    ]);
    expect(groups.map((g) => [g.label, g.count])).toEqual([['chair', 2], ['bottle', 1], ['laptop', 1]]);
    expect(groups[0].items.map((d) => d.confidence)).toEqual([0.8, 0.5]);
    expect(groups[0].canLook).toBe(true);
  });

  it('keeps label-only results from a remote detector, but they cannot turn the camera', () => {
    const [group] = groupDetections([{ label: 'tv', confidence: 0.6 }, { confidence: 0.9 }]);
    expect(group).toMatchObject({ label: 'tv', count: 1, canLook: false });
    expect(nextDetection(group)).toBeNull();
  });

  it('treats labels as text even if a detector sent numbers', () => {
    const groups = groupDetections([{ label: 56 }, { label: 62 }, { label: 0 }]);
    expect(groups.map((g) => g.label)).toEqual(['0', '56', '62']);
  });

  it('handles a scene that was never scanned', () => {
    expect(groupDetections(undefined)).toEqual([]);
  });
});

describe('nextDetection', () => {
  it('cycles through the instances of a label and wraps around', () => {
    const [group] = groupDetections([chair(0.5, 10), chair(0.8, 120), chair(0.6, -90)]);
    const first = nextDetection(group);
    expect(first).toMatchObject({ index: 0, detection: { yawDeg: 120 } });
    expect(nextDetection(group, first.index).detection.yawDeg).toBe(-90);
    expect(nextDetection(group, 2).index).toBe(0);
  });
});
