/**
 * SmartNav360 — Project Service
 * All project-related API operations.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const ProjectService = {
  /**
   * Create a new project.
   * @param {{ name: string, description?: string }} data
   * @returns {Promise<object>} Created project
   */
  async createProject(data) {
    const response = await apiClient.post(API_ENDPOINTS.PROJECTS, data);
    return response.data;
  },

  /**
   * Fetch all projects.
   * Gracefully handles 404 if GET endpoint is not yet implemented.
   * @returns {Promise<object[]>} Array of projects
   */
  async getProjects() {
    try {
      const response = await apiClient.get(API_ENDPOINTS.PROJECTS);
      return response.data;
    } catch (error) {
      if (error.status === 404) {
        return { success: true, data: [] };
      }
      throw error;
    }
  },

  /**
   * Future: Update a project by ID.
   * @param {string} id
   * @param {object} data
   */
  async updateProject(id, data) {
    const response = await apiClient.put(`${API_ENDPOINTS.PROJECTS}/${id}`, data);
    return response.data;
  },

  /**
   * Future: Delete a project by ID.
   * @param {string} id
   */
  async deleteProject(id) {
    const response = await apiClient.delete(`${API_ENDPOINTS.PROJECTS}/${id}`);
    return response.data;
  },
};

export default ProjectService;
