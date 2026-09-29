import { describe, it, expect, vi } from "vitest";
import { parseGpuMatches, requestGpuMatches } from "./gpuMatching";

const frames = [
  { width: 1600, height: 1200 },
  { width: 1600, height: 1200 },
];
const reply = {
  matcher: "superpoint-lightglue",
  device: "GPU (DirectML adapter 1)",
  elapsedMs: 210,
  modelVersion: "superpoint-lightglue@v2.0",
  frames,
  pairs: [{ from: 0, to: 1, matches: [[10, 20, 30, 40, 0.9]] }],
};

describe("parseGpuMatches", () => {
  it("turns each pair into match objects keyed by frame indexes", () => {
    const parsed = parseGpuMatches(reply, frames);
    expect(parsed.matches.get("0-1")).toEqual([{ x1: 10, y1: 20, x2: 30, y2: 40 }]);
    expect(parsed.device).toBe("GPU (DirectML adapter 1)");
    expect(parsed.elapsedMs).toBe(210);
  });

  it("refuses a reply computed on differently sized frames", () => {
    expect(parseGpuMatches({ ...reply, frames: [{ width: 800, height: 600 }, frames[1]] }, frames)).toBeNull();
    expect(parseGpuMatches({ ...reply, frames: [frames[0]] }, frames)).toBeNull();
  });

  it("refuses malformed replies", () => {
    expect(parseGpuMatches(undefined, frames)).toBeNull();
    expect(parseGpuMatches({ ...reply, pairs: [{ from: 0, to: 1 }] }, frames)).toBeNull();
    expect(parseGpuMatches({ frames }, frames)).toBeNull();
  });
});

describe("requestGpuMatches", () => {
  const canvas = { toBlob: (done) => done(new Blob(["x"], { type: "image/jpeg" })) };
  const withCanvas = frames.map((frame) => ({ ...frame, canvas }));

  it("uploads every frame and returns the parsed matches", async () => {
    const service = { matchFrames: vi.fn().mockResolvedValue({ success: true, data: reply }) };
    const { result, error } = await requestGpuMatches(withCanvas, [[0, 1]], service);
    expect(error).toBeNull();
    expect(service.matchFrames).toHaveBeenCalledWith([expect.any(Blob), expect.any(Blob)], [[0, 1]]);
    expect(result.matches.get("0-1")).toHaveLength(1);
  });

  it("resolves to null with a reason instead of throwing when the server fails", async () => {
    const service = { matchFrames: vi.fn().mockRejectedValue({ status: 503, message: "GPU feature matching is not available" }) };
    const { result, error } = await requestGpuMatches(withCanvas, [[0, 1]], service);
    expect(result).toBeNull();
    expect(error).toBe("GPU feature matching is not available");
  });
});
