/**
 * SmartNav360 — API Endpoint Constants
 * Centralized definition of all backend API endpoints.
 */

const API_PORT = import.meta.env.VITE_API_PORT || '5000';

/**
 * Resolves the backend base URL without hard-coding a machine's LAN address.
 *
 * Order:
 *  1. VITE_API_BASE_URL — an explicit override always wins.
 *  2. The host this page was served from, when that is not localhost. Opening
 *     the dev server at http://<lan-ip>:5173 then yields http://<lan-ip>:5000,
 *     so a phone on the same Wi-Fi or hotspot works with no configuration and
 *     no edit when the laptop or network changes.
 *  3. localhost, for the ordinary single-machine case.
 */
function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname } = window.location;
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (!isLoopback && hostname) return `${protocol}//${hostname}:${API_PORT}`;
  }
  return `http://localhost:${API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();

/** True when API_BASE_URL is reachable from another device on the network. */
export const API_BASE_IS_SHAREABLE = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/i.test(API_BASE_URL);

export const API_ENDPOINTS = {
  /* ---- Projects ---- */
  PROJECTS: '/api/projects',

  /* ---- Scenes ---- */
  SCENES: '/api/scenes',
  SCENE_BY_ID: (id) => `/api/scenes/${id}`,
  CONNECT_SCENES: (id) => `/api/scenes/${id}/connect`,

  /* ---- Upload ---- */
  UPLOAD: '/api/upload',
  UPLOAD_BY_ID: (id) => `/api/upload/${id}`,
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

  /* ---- Panorama capture sessions ---- */
  PANORAMA_SESSIONS: '/api/panorama/sessions',
  PANORAMA_SESSION_BY_TOKEN: (token) => `/api/panorama/sessions/${token}`,
  PANORAMA_SESSION_STREAM: (token) => `/api/panorama/sessions/${token}/stream`,
  PANORAMA_SESSION_PHOTOS: (token) => `/api/panorama/sessions/${token}/photos`,
  PANORAMA_SESSION_COMPLETE: (token) => `/api/panorama/sessions/${token}/complete`,

  /* ---- Auth ---- */
  AUTH_REGISTER: '/api/auth/register',
  AUTH_LOGIN: '/api/auth/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_ME: '/api/auth/me',
  AUTH_REFRESH: '/api/auth/refresh',

  /* ---- Health ---- */
  HEALTH: '/healthz',
};
