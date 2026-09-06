/**
 * SmartNav360 — AI Service (Placeholder)
 * Architecture-ready for Gemini AI integration.
 * Replace placeholder logic when AI backend endpoints are implemented.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const AIService = {
  /**
   * Send a chat message to the AI.
   * Future: apiClient.post(API_ENDPOINTS.AI_CHAT, { message, context })
   */
  async sendMessage(message, context = {}) {
    const response = await apiClient.post(API_ENDPOINTS.AI_CHAT, { message, ...context });
    return response.data;
  },

  /**
   * Search navigation using AI.
   * Future: apiClient.post(API_ENDPOINTS.AI_SEARCH, { query })
   */
  async searchNavigation(query) {
    return {
      success: true,
      data: {
        results: [],
        message: 'AI search is not yet available.',
      },
    };
  },

  /**
   * Get optimal navigation path between scenes.
   * Future: apiClient.get(API_ENDPOINTS.AI_NAVIGATION, { params })
   */
  async getNavigationPath(projectId, fromSceneId, toSceneId) {
    const response = await apiClient.get(API_ENDPOINTS.NAVIGATION_PATH, { params: { projectId, fromSceneId, toSceneId } });
    return response.data;
  },
};

export default AIService;
