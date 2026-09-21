/**
 * SmartNav360 — Panorama Stitch Worker
 * Runs the OpenCV pipeline off the main thread.
 *
 * The compositing step is a per-pixel loop over a canvas that grows with every
 * photo, and OpenCV.js itself is a multi-megabyte WASM module. On the main
 * thread both freeze the UI for the whole stitch; here they cost nothing
 * visible, and the page stays interactive with a live progress bar.
 */

import { stitchImages, StitchError } from '../utils/stitchPanorama';

self.onmessage = async (event) => {
  const { imageBitmaps, imageUrls } = event.data || {};
  try {
    const blob = await stitchImages(imageBitmaps || imageUrls, (info) => {
      self.postMessage({ type: 'progress', ...info });
    });
    self.postMessage({ type: 'done', blob });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error?.message || 'Could not stitch these photos.',
      reason: error instanceof StitchError ? error.reason : null,
    });
  }
};
