/**
 * SmartNav360 — Date Formatting Utility
 */

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/**
 * Format a date string or timestamp.
 * @param {string|Date} date
 * @param {string} [format='MMM D, YYYY']
 * @returns {string}
 */
export function formatDate(date, format = 'MMM D, YYYY') {
  if (!date) return '—';
  return dayjs(date).format(format);
}

/**
 * Format a date as relative time (e.g., "2 hours ago").
 * @param {string|Date} date
 * @returns {string}
 */
export function formatRelativeDate(date) {
  if (!date) return '—';
  return dayjs(date).fromNow();
}

/**
 * Format a date with time.
 * @param {string|Date} date
 * @returns {string}
 */
export function formatDateTime(date) {
  return formatDate(date, 'MMM D, YYYY · h:mm A');
}
