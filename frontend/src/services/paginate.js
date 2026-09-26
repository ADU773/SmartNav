/**
 * SmartNav360 — List pagination helper
 *
 * The API pages every list endpoint and clamps page size to 200. Screens that
 * need the whole collection (pickers, the scene graph) must walk every page;
 * requesting only the first silently drops everything past it.
 */

import apiClient from './api';

const PAGE_SIZE = 200; // the server's maximum
const MAX_PAGES = 50; // a hard stop so a misbehaving server cannot loop forever

/**
 * Fetches every page of a list endpoint and returns one combined response in
 * the usual `{ success, data, count }` shape.
 *
 * @param {string} url
 * @param {object} [params] - extra query parameters, e.g. { projectId }
 */
export async function fetchAllPages(url, params = {}) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await apiClient.get(url, { params: { ...params, page, limit: PAGE_SIZE } });
    const body = response.data;
    items.push(...(body.data || []));
    // Servers without pagination metadata return everything at once.
    if (!body.meta?.hasMore) break;
  }
  return { success: true, data: items, count: items.length };
}
