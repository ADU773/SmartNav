/**
 * SmartNav360 — Text Truncation Utility
 */

/**
 * Truncate text to a maximum length with ellipsis.
 * @param {string} text
 * @param {number} [maxLength=100]
 * @returns {string}
 */
export function truncateText(text, maxLength = 100) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
