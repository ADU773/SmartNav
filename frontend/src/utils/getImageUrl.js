/**
 * SmartNav360 — Image URL Utility
 * Constructs full image URLs from backend-relative paths.
 */

import { API_BASE_URL } from '../constants/api';
const privateLinks = new Map();
export function clearMediaLinks() { privateLinks.clear(); }
export function rememberMedia(links) {
  for (const [path, url] of Object.entries(links || {})) privateLinks.set(path, url);
}

/**
 * Build a full URL for an uploaded image.
 * @param {string} path — The image path from the backend (e.g., 'uploads/1234.jpg')
 * @returns {string|null} Full URL or null if no path
 */
export function getImageUrl(path) {
  if (!path) return null;
  if (privateLinks.has(path)) return API_BASE_URL + privateLinks.get(path);

  // Already a full URL
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;

  return `${API_BASE_URL}/${cleanPath}`;
}
