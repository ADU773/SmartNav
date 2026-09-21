/**
 * SmartNav360 — Panorama Capture Service
 * Manages QR-linked multi-photo capture sessions used by the Panoramic Viewer.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const PanoramaService = {
  /**
   * Start a new capture session scoped to a project.
   * @param {string} projectId
   * @returns {Promise<object>} { success, data: { token, status, expiresAt } }
   */
  async createSession(projectId) {
    const response = await apiClient.post(API_ENDPOINTS.PANORAMA_SESSIONS, { projectId });
    return response.data;
  },

  /**
   * Fetch a session's current status and captured photos.
   * @param {string} token
   * @returns {Promise<object>} { success, data: { status, photos, expiresAt } }
   */
  async getSession(token) {
    const response = await apiClient.get(API_ENDPOINTS.PANORAMA_SESSION_BY_TOKEN(token));
    return response.data;
  },

  /**
   * Upload one captured photo into the session.
   * @param {string} token
   * @param {File} file
   * @param {function} [onProgress] - Progress callback (0-100)
   * @returns {Promise<object>} { success, data: { photos } }
   */
  async uploadPhoto(token, file, onProgress) {
    if (!file) throw new Error('A photo is required.');
    const formData = new FormData();
    formData.append('image', file);
    const response = await apiClient.post(API_ENDPOINTS.PANORAMA_SESSION_PHOTOS(token), formData, {
      timeout: 300000,
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
        }
      },
    });
    return response.data;
  },

  /**
   * Mark a session as done capturing (phone side).
   * @param {string} token
   * @returns {Promise<object>} { success, data: { status, photos } }
   */
  async completeSession(token) {
    const response = await apiClient.post(API_ENDPOINTS.PANORAMA_SESSION_COMPLETE(token));
    return response.data;
  },
};

export default PanoramaService;
