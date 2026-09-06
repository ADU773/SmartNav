/**
 * SmartNav360 — API Endpoint Constants
 * Centralized definition of all backend API endpoints.
 */

export const API_BASE_URL = 'http://localhost:5000';

export const API_ENDPOINTS = {
  /* ---- Projects ---- */
  PROJECTS: '/api/projects',

  /* ---- Scenes ---- */
  SCENES: '/api/scenes',
  SCENE_BY_ID: (id) => `/api/scenes/${id}`,
  CONNECT_SCENES: (id) => `/api/scenes/${id}/connect`,

  /* ---- Upload ---- */
  UPLOAD: '/api/upload',
  UPLOADS_STATIC: '/uploads',

  /* ---- AI (future) ---- */
  AI_CHAT: '/api/ai/chat',
  AI_SEARCH: '/api/ai/search',
  AI_NAVIGATION: '/api/navigation',
  NAVIGATION_PATH: '/api/navigation/path',
  ANALYTICS_EVENTS: '/api/analytics/events',
  ANALYTICS_PROJECT: (id) => `/api/analytics/projects/${id}`,
  PUBLISH_PROJECT: (id) => `/api/projects/${id}/publish`,
  EXPORT_PROJECT: (id) => `/api/projects/${id}/export`,
  PUBLISHED_PROJECT: (token) => `/api/published/${token}`,
  VISION_DETECT: '/api/vision/detect',

  /* ---- Auth (future) ---- */
  AUTH_LOGIN: '/api/auth/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_ME: '/api/auth/me',
  AUTH_REFRESH: '/api/auth/refresh',
};
