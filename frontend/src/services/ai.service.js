/**
 * SmartNav360 — AI Service (Placeholder)
 * Chat answers come from the backend, which asks OpenAI or Gemini (or a local model).
 * Replace placeholder logic when AI backend endpoints are implemented.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const AIService = {
  /**
   * Send a chat message to the AI.
   * @param {string} message
   * @param {{ projectId?: string, history?: { role: 'user'|'assistant', content: string }[] }} context
   *   history: earlier turns of this conversation, oldest first, so follow-up
   *   questions ("and back?") make sense. The server trims it to fit.
   */
  async sendMessage(message, context = {}) {
    // Longer than the default 30 s: route and object questions take a few
    // model calls, and a busy model is retried on a fallback model.
    const response = await apiClient.post(API_ENDPOINTS.AI_CHAT, { message, ...context }, { timeout: 120000 });
    return response.data;
  },

  /**
   * Search navigation using AI.
   * Future: apiClient.post(API_ENDPOINTS.AI_SEARCH, { query })
   */
  async searchNavigation(_query) {
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
  /**
   * @param {string[]} [avoid] - access modes to exclude entirely, e.g.
   *   ['stairs','escalator'] for a step-free route. Excluded modes are removed
   *   from the graph, so the result is genuinely step-free rather than merely
   *   cheaper; the request 404s when no such route exists.
   */
  async getNavigationPath(projectId, fromSceneId, toSceneId, avoid = []) {
    const response = await apiClient.get(API_ENDPOINTS.NAVIGATION_PATH, {
      params: {
        projectId,
        fromSceneId,
        toSceneId,
        ...(avoid.length ? { avoid: avoid.join(',') } : {}),
      },
    });
    return response.data;
  },
};

export default AIService;
