/**
 * SmartNav360 — Upload Service
 * Handles file uploads with progress tracking.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const UploadService = {
  /**
   * Upload an image file.
   * @param {File} file - The file to upload
   * @param {string} projectId - The project that owns the upload
   * @param {function} [onProgress] - Progress callback (0-100)
   * @returns {Promise<object>} { success, data: { filename, path, ... } }
   */


  async uploadImage(file, projectId, onProgress) {
    if (!file || !projectId) throw new Error('An image and project are required.');
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('image', file);
    const response = await apiClient.post(API_ENDPOINTS.UPLOAD, formData, {
      // Large panoramas can take longer than the default API timeout.
      timeout: 300000,
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          onProgress(percent);
        }
      },
    });

    return response.data;
  },

  async getUploads(projectId) {

    const response = await apiClient.get(

        API_ENDPOINTS.UPLOAD,

        {

            params:{

                projectId

            }

        }

    );

    return response.data;

},
};



export default UploadService;
