/**
 * SmartNav360 — useDocumentTitle Hook
 * Sets the browser document title.
 */

import { useEffect } from 'react';

const BASE_TITLE = 'SmartNav360';

/**
 * @param {string} title — Page title to prepend
 */
export function useDocumentTitle(title) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title ? `${title} — ${BASE_TITLE}` : BASE_TITLE;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
