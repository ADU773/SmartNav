/**
 * SmartNav360 — Axios Instance
 * Centralized HTTP client with interceptors, error handling,
 * and architecture for future JWT token injection.
 */

import axios from 'axios';
import { API_BASE_URL } from '../constants/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  // Axios serializes plain objects as JSON and lets the browser set the
  // multipart boundary for FormData. Do not force a content type here.
});

/* ---- Request Interceptor ---- */
apiClient.interceptors.request.use(
  (config) => {
    /**
     * Future JWT Token Injection:
     * const token = localStorage.getItem('auth_token');
     * if (token) {
     *   config.headers.Authorization = `Bearer ${token}`;
     * }
     */
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/* ---- Response Interceptor ---- */
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const normalizedError = normalizeError(error);

    /**
     * Future: Handle 401 Unauthorized
     * if (normalizedError.status === 401) {
     *   localStorage.removeItem('auth_token');
     *   window.location.href = '/login';
     * }
     */

    return Promise.reject(normalizedError);
  }
);

/**
 * Normalizes Axios errors into a consistent shape for the application.
 */
function normalizeError(error) {
  if (error.response) {
    return {
      status: error.response.status,
      message: error.response.data?.message || getStatusMessage(error.response.status),
      data: error.response.data,
    };
  }

  if (error.code === 'ECONNABORTED') {
    return {
      status: 408,
      message: 'The request timed out. Please try again.',
      data: null,
    };
  }

  return {
    status: 0,
    message: 'Unable to connect to the server. Please check your connection.',
    data: null,
  };
}

/**
 * Returns a human-readable message for common HTTP status codes.
 */
function getStatusMessage(status) {
  const messages = {
    400: 'The request was invalid.',
    401: 'You are not authorized. Please log in.',
    403: 'You do not have permission to perform this action.',
    404: 'The requested resource was not found.',
    409: 'A conflict occurred with the current state.',
    422: 'The submitted data is invalid.',
    429: 'Too many requests. Please try again later.',
    500: 'An unexpected server error occurred.',
    502: 'The server is temporarily unavailable.',
    503: 'The service is currently unavailable.',
  };

  return messages[status] || `An error occurred (${status}).`;
}

export default apiClient;
