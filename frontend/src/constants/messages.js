/**
 * SmartNav360 — User-Facing Messages
 * Centralized notification and UI messages.
 */

export const MESSAGES = {
  /* ---- Project ---- */
  PROJECT_CREATED: 'Project created successfully',
  PROJECT_UPDATED: 'Project updated successfully',
  PROJECT_DELETED: 'Project deleted successfully',
  PROJECT_CREATE_ERROR: 'Failed to create project',
  PROJECT_LOAD_ERROR: 'Failed to load projects',

  /* ---- Scene ---- */
  SCENE_CREATED: 'Scene created successfully',
  SCENE_UPDATED: 'Scene updated successfully',
  SCENE_DELETED: 'Scene deleted successfully',
  SCENE_CREATE_ERROR: 'Failed to create scene',
  SCENE_DELETE_ERROR: 'Failed to delete scene',
  SCENE_LOAD_ERROR: 'Failed to load scenes',

  /* ---- Upload ---- */
  UPLOAD_SUCCESS: 'File uploaded successfully',
  UPLOAD_ERROR: 'Failed to upload file',
  UPLOAD_PROGRESS: 'Uploading...',

  /* ---- Connection ---- */
  CONNECTION_ADDED: 'Scenes connected successfully',
  CONNECTION_REMOVED: 'Connection removed successfully',
  CONNECTION_ERROR: 'Failed to connect scenes',
  CONNECTION_EXISTS: 'This connection already exists',

  /* ---- Auth ---- */
  LOGIN_SUCCESS: 'Logged in successfully',
  LOGIN_ERROR: 'Invalid email or password',
  LOGOUT_SUCCESS: 'Logged out successfully',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',

  /* ---- Network ---- */
  NETWORK_ERROR: 'Unable to connect to the server. Please check your connection.',
  TIMEOUT_ERROR: 'The request timed out. Please try again.',
  SERVER_ERROR: 'An unexpected server error occurred.',
  NOT_FOUND: 'The requested resource was not found.',

  /* ---- General ---- */
  CONFIRM_DELETE: 'Are you sure you want to delete this? This action cannot be undone.',
  UNSAVED_CHANGES: 'You have unsaved changes. Are you sure you want to leave?',

  /* ---- Future ---- */
  AI_COMING_SOON: 'AI features are coming soon. The Gemini integration is being prepared.',
  ANALYTICS_PENDING: 'Analytics module is pending backend integration.',
  DEPLOYMENT_COMING_SOON: 'Deployment features are coming soon.',
};
