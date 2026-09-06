/**
 * SmartNav360 — File Size Formatting Utility
 */

/**
 * Format bytes into a human-readable string.
 * @param {number} bytes
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatFileSize(bytes, decimals = 1) {
  if (bytes === 0 || bytes == null) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}
