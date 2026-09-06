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
   * @param {function} [onProgress] - Progress callback (0-100)
   * @returns {Promise<object>} { success, filename, path }
   */


  async uploadImage(file, projectId, onProgress) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('projectId', projectId);
    const response = await apiClient.post(API_ENDPOINTS.UPLOAD, formData, {
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
