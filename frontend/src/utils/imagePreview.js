/**
 * SmartNav360 — Image preview helpers
 *
 * Pickers and scene strips show many images at once. The upload pipeline
 * writes a small WebP thumbnail beside every asset, so previews should use
 * that rather than the full panorama, which can run to tens of megabytes.
 * Assets uploaded before the pipeline existed have no thumbnail and fall back
 * to the original.
 */

import { getImageUrl } from './getImageUrl';

/** Preview URL for an asset: its thumbnail when one exists. */
export function assetPreviewUrl(asset) {
  if (!asset) return null;
  return getImageUrl(asset.thumbnailPath || asset.path);
}

/** Display name for an asset. */
export function assetLabel(asset) {
  return asset?.originalName || asset?.filename || asset?.path || 'Untitled image';
}

/**
 * Maps every stored form of an asset's path to its preview URL, so a scene
 * (which stores only an image path) can be shown with its asset's thumbnail.
 * @param {object[]} assets
 * @returns {Map<string, string>}
 */
export function buildPreviewIndex(assets = []) {
  const index = new Map();
  for (const asset of assets) {
    if (!asset?.path) continue;
    const url = assetPreviewUrl(asset);
    index.set(asset.path, url);
    index.set(asset.path.replace(/^\//, ''), url);
  }
  return index;
}

/**
 * Preview URL for a scene's image, preferring the asset thumbnail.
 * @param {{ image?: string }} scene
 * @param {Map<string, string>} [index] - from buildPreviewIndex
 */
export function scenePreviewUrl(scene, index) {
  if (!scene?.image) return null;
  let path = scene.image;
  // Absolute URLs to this app's own uploads still map to their thumbnail.
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    // Not a parseable URL; use it as-is.
  }
  return index?.get(path) || getImageUrl(scene.image);
}

/** Human-readable resolution, e.g. "8192 × 4096". */
export function formatResolution(asset) {
  if (!asset?.width || !asset?.height) return null;
  return `${asset.width} × ${asset.height}`;
}
