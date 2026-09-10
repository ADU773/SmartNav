/**
 * SmartNav360 — Scene Service
 * All scene-related API operations.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const SceneService = {
  /**
   * Fetch all scenes.
   * @param {object} [params] Optional query params (e.g., projectId)
   * @returns {Promise<object>} { success, count, data }
   */
  async getScenes(projectId) {

    const response = await apiClient.get(

        API_ENDPOINTS.SCENES,

        {

            params: {

                projectId

            }

        }

    );

    return response.data;

},

  /**
   * Fetch a single scene by ID.
   * @param {string} id
   * @returns {Promise<object>} { success, data }
   */
  async getSceneById(id) {
    const response = await apiClient.get(API_ENDPOINTS.SCENE_BY_ID(id));
    return response.data;
  },

  /**
   * Create a new scene.
   * @param {{ projectId: string, name: string, image?: string }} data
   * @returns {Promise<object>} Created scene
   */
  async createScene(data) {
    const response = await apiClient.post(API_ENDPOINTS.SCENES, data);
    return response.data;
  },

  /**
   * Delete a scene by ID.
   * @param {string} id
   * @returns {Promise<object>} { success, message }
   */
  async deleteScene(id) {
    const response = await apiClient.delete(API_ENDPOINTS.SCENE_BY_ID(id));
    return response.data;
  },

  async updateScene(id, data) {
    const response = await apiClient.put(API_ENDPOINTS.SCENE_BY_ID(id), data);
    return response.data;
  },

  /**
   * Connect two scenes by creating a hotspot.
   * @param {string} sourceSceneId
   * @param {{ targetSceneId: string, label?: string, yaw?: number, pitch?: number, distance?: number }} data
   * @returns {Promise<object>} Updated scene
   */
  async connectScenes(sourceSceneId, data) {
    const response = await apiClient.post(
      API_ENDPOINTS.CONNECT_SCENES(sourceSceneId),
      data
    );
    return response.data;
  },
};

export default SceneService;
