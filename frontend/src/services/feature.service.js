import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const FeatureService = {
  trackEvent: (data) => apiClient.post(API_ENDPOINTS.ANALYTICS_EVENTS, data).then((response) => response.data),
  getAnalytics: (projectId) => apiClient.get(API_ENDPOINTS.ANALYTICS_PROJECT(projectId)).then((response) => response.data),
  publishProject: (projectId) => apiClient.post(API_ENDPOINTS.PUBLISH_PROJECT(projectId)).then((response) => response.data),
  exportProject: (projectId) => apiClient.get(API_ENDPOINTS.EXPORT_PROJECT(projectId)).then((response) => response.data),
  // The first scan may have to load the detection model on the server.
  detectObjects: (sceneId) => apiClient.post(API_ENDPOINTS.VISION_DETECT, { sceneId }, { timeout: 180000 }).then((response) => response.data),
  getPublishedProject: (token) => apiClient.get(API_ENDPOINTS.PUBLISHED_PROJECT(token)).then((response) => response.data),
};

export default FeatureService;
