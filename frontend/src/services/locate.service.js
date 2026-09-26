/**
 * SmartNav360 — Locate Service
 * "Where am I?": sends a photo to the backend, which matches it against every
 * scene's panorama and returns the likely scene and heading.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const LocateService = {
  /**
   * @param {File|Blob} photo
   * @param {{ projectId?: string, shareToken?: string }} target - the owner's
   *   project, or a published tour's share token for anonymous visitors
   * @returns {Promise<object>} { success, data: { matches: [{ sceneId, name, image, score, yawDeg, confidence }], ... } }
   */
  async locate(photo, { projectId, shareToken }) {
    const form = new FormData();
    form.append('image', photo);
    if (shareToken) form.append('shareToken', shareToken);
    else form.append('projectId', projectId);
    // The first request in a project also builds its index, about a second per scene.
    const response = await apiClient.post(API_ENDPOINTS.LOCATE, form, { timeout: 180000 });
    return response.data;
  },

  /** Builds the index ahead of time so visitors are not the ones waiting. */
  async buildIndex(projectId) {
    const response = await apiClient.post(API_ENDPOINTS.LOCATE_INDEX(projectId), null, { timeout: 600000 });
    return response.data;
  },

  /** @returns {Promise<object>} { success, data: { scenesWithImages, indexed, pending } } */
  async status(projectId) {
    const response = await apiClient.get(API_ENDPOINTS.LOCATE_STATUS(projectId));
    return response.data;
  },
};

export default LocateService;
