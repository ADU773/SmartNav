import { test } from "vitest";
import assert from "node:assert/strict";
import {
  XFEAT_DESCRIPTOR_DIM,
  extractFeatures,
  matchMutualNearest,
  pixelsToTensorData,
  xfeatInputSize,
} from "./xfeat.js";

const DIM = XFEAT_DESCRIPTOR_DIM;

/** A unit vector along one axis, as a descriptor. */
function axis(index) {
  const v = new Float32Array(DIM);
  v[index] = 1;
  return v;
}

function stack(vectors) {
  const out = new Float32Array(vectors.length * DIM);
  vectors.forEach((v, i) => out.set(v, i * DIM));
  return out;
}

test("input size keeps the long edge at 1024 and both sides on multiples of 32", () => {
  // The stitcher's working frames: portrait and landscape 3:4, and a
  // screen-shaped crop that does not divide evenly.
  assert.deepEqual(xfeatInputSize(1200, 1600), { inputWidth: 768, inputHeight: 1024 });
  assert.deepEqual(xfeatInputSize(1600, 1200), { inputWidth: 1024, inputHeight: 768 });
  const cropped = xfeatInputSize(739, 1600);
  assert.equal(cropped.inputHeight, 1024);
  assert.equal(cropped.inputWidth % 32, 0);
  assert.ok(cropped.inputWidth <= Math.round((739 * 1024) / 1600));
  // Small frames are never upscaled, but still land on the 32 grid.
  assert.deepEqual(xfeatInputSize(100, 70), { inputWidth: 96, inputHeight: 64 });
});

test("pixels become planar RGB in 0..1, ignoring alpha", () => {
  const rgba = new Uint8ClampedArray([255, 0, 51, 7, 0, 255, 102, 9]);
  const data = pixelsToTensorData(rgba, 2, 1, 4);
  assert.deepEqual(Array.from(data, (v) => Math.round(v * 100) / 100), [1, 0, 0, 1, 0.2, 0.4]);
});

test("mutual nearest neighbours pair each descriptor with its true match", () => {
  const a = stack([axis(0), axis(1), axis(2)]);
  const b = stack([axis(2), axis(0), axis(1)]);
  const matches = matchMutualNearest(a, 3, b, 3).map(({ queryIdx, trainIdx }) => [queryIdx, trainIdx]);
  assert.deepEqual(matches, [[0, 1], [1, 2], [2, 0]]);
});

test("a match must be mutual, not just one-sided", () => {
  // Both A0 and A1 point at B0, but B0 prefers A0; A1 therefore has no match.
  const near = new Float32Array(DIM);
  near[0] = 0.95;
  near[1] = Math.sqrt(1 - 0.95 * 0.95);
  const a = stack([axis(0), near]);
  const b = stack([axis(0)]);
  assert.deepEqual(
    matchMutualNearest(a, 2, b, 1).map(({ queryIdx, trainIdx }) => [queryIdx, trainIdx]),
    [[0, 0]],
  );
});

test("weak mutual matches below the cosine threshold are dropped", () => {
  const weak = new Float32Array(DIM);
  weak[0] = 0.5;
  weak[1] = Math.sqrt(0.75);
  assert.equal(matchMutualNearest(stack([axis(0)]), 1, stack([weak]), 1).length, 0);
  assert.equal(matchMutualNearest(stack([axis(0)]), 1, stack([weak]), 1, 0.4).length, 1);
  assert.deepEqual(matchMutualNearest(new Float32Array(0), 0, stack([axis(0)]), 1), []);
});

/** Builds synthetic model outputs for a width x height input. */
function syntheticOutputs(width, height, peaks, denseVector) {
  const heatmap = new Float32Array(width * height);
  const reliability = new Float32Array(width * height).fill(1);
  for (const { x, y, value } of peaks) heatmap[y * width + x] = value;
  const fw = width / 8;
  const fh = height / 8;
  const descriptors = new Float32Array(DIM * fw * fh);
  for (let c = 0; c < DIM; c += 1) descriptors.fill(denseVector[c], c * fw * fh, (c + 1) * fw * fh);
  return { heatmap, reliability, descriptors };
}

test("peaks are thresholded, non-maximum suppressed, ranked and rescaled", () => {
  const dense = new Float32Array(DIM);
  dense[3] = 3; // deliberately not unit length: extraction must normalise
  dense[7] = 4;
  const outputs = syntheticOutputs(64, 64, [
    { x: 20, y: 20, value: 0.9 },
    { x: 21, y: 21, value: 0.5 }, // inside the 5x5 window of the stronger peak
    { x: 50, y: 10, value: 0.3 },
    { x: 5, y: 60, value: 0.04 }, // below the 0.05 detection threshold
  ], dense);

  // Reported in a frame twice the input size.
  const result = extractFeatures(outputs, 64, 64, 128, 128);

  assert.equal(result.count, 2);
  assert.deepEqual(result.points, [{ x: 40, y: 40 }, { x: 100, y: 20 }], "ranked by score, scaled to the frame");

  for (let k = 0; k < result.count; k += 1) {
    const d = result.descriptors.subarray(k * DIM, (k + 1) * DIM);
    const norm = Math.sqrt(d.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(norm - 1) < 1e-5, "descriptors are unit length");
    // A constant dense map samples back to itself: bicubic weights sum to one.
    assert.ok(Math.abs(d[3] - 0.6) < 1e-4 && Math.abs(d[7] - 0.8) < 1e-4);
  }
});

test("topK keeps only the strongest keypoints", () => {
  const dense = axis(0);
  const peaks = Array.from({ length: 6 }, (_, i) => ({ x: 4 + i * 10, y: 30, value: 0.1 + i * 0.1 }));
  const result = extractFeatures(syntheticOutputs(64, 64, peaks, dense), 64, 64, 64, 64, { topK: 3 });
  assert.equal(result.count, 3);
  assert.deepEqual(result.points.map((p) => p.x), [54, 44, 34]);
});
