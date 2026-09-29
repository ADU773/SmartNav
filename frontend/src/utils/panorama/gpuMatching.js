/**
 * SmartNav360 — GPU feature matching through the backend
 *
 * The backend runs SuperPoint + LightGlue on the server's GPU. This module
 * uploads the working-resolution frames, and turns the reply into the same
 * { x1, y1, x2, y2 } match lists the rest of the registration code consumes.
 *
 * It is an accelerator, never a requirement: any failure (signed out, server
 * without the model, network) resolves to null and the caller falls back to
 * the in-browser matchers.
 */

import PanoramaService from "../../services/panorama.service";

const JPEG_QUALITY = 0.9;

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode a frame for upload."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/**
 * Validates a match reply against the frames that were sent and converts it.
 *
 * @param {object} data - the `data` of the API reply
 * @param {{ width: number, height: number }[]} frames - what was uploaded
 * @returns {{ matches: Map<string, {x1:number,y1:number,x2:number,y2:number}[]>, device: string|null,
 *   elapsedMs: number|null, modelVersion: string|null } | null} null if the reply is not usable
 */
export function parseGpuMatches(data, frames) {
  if (!data || !Array.isArray(data.pairs) || !Array.isArray(data.frames)) return null;
  // Coordinates are in the uploaded frames' pixels; if the server saw different
  // sizes they would not line up with the frames the registration works on.
  const sameSizes =
    data.frames.length === frames.length &&
    data.frames.every((size, i) => size.width === frames[i].width && size.height === frames[i].height);
  if (!sameSizes) return null;

  const matches = new Map();
  for (const pair of data.pairs) {
    if (!Array.isArray(pair.matches)) return null;
    matches.set(
      `${pair.from}-${pair.to}`,
      pair.matches.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 })),
    );
  }
  return {
    matches,
    device: data.device ?? null,
    elapsedMs: typeof data.elapsedMs === "number" ? data.elapsedMs : null,
    modelVersion: data.modelVersion ?? null,
  };
}

/**
 * Asks the backend to match the given frame pairs.
 *
 * @param {{ canvas: HTMLCanvasElement, width: number, height: number }[]} frames
 * @param {[number, number][]} links
 * @returns {Promise<{ result: ReturnType<typeof parseGpuMatches>, error: string|null }>}
 *   `result` is null when GPU matching was not available; `error` says why
 */
export async function requestGpuMatches(frames, links, service = PanoramaService) {
  try {
    const blobs = [];
    for (const frame of frames) blobs.push(await canvasToJpeg(frame.canvas));
    const reply = await service.matchFrames(blobs, links);
    const result = parseGpuMatches(reply?.data, frames);
    return result ? { result, error: null } : { result: null, error: "the server sent a reply that did not match the frames" };
  } catch (error) {
    return { result: null, error: error?.message || "unknown error" };
  }
}
