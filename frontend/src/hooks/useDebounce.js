/**
 * SmartNav360 — useDebounce Hook
 * Debounces a value by a specified delay.
 */

import { useState, useEffect } from 'react';

/**
 * @param {*} value — The value to debounce
 * @param {number} [delay=300] — Delay in milliseconds
 * @returns {*} The debounced value
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
