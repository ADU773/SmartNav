/**
 * SmartNav360 — Axios Instance
 * Centralized HTTP client with JWT injection, transparent access-token refresh,
 * and normalized errors.
 */

import axios from 'axios';
import { API_BASE_URL, API_ENDPOINTS } from '../constants/api';
import { getAccessToken, getRefreshToken, setSession, clearSession } from './tokenStore';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  // Axios serializes plain objects as JSON and lets the browser set the
  // multipart boundary for FormData. Do not force a content type here.
});

// Refresh must not be attempted through apiClient itself, or a 401 on the
// refresh call would recurse through this same interceptor. Exported so tests
// can intercept it the same way they intercept apiClient.
export const refreshClient = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

/* ---- Request Interceptor ---- */
apiClient.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// A single in-flight refresh shared by every request that got a 401 at once,
// so ten parallel calls rotate the refresh token once rather than ten times
// (which would trip the server's replay detection and sign the user out).
let refreshInFlight = null;

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token');

  refreshInFlight ||= refreshClient
    .post(API_ENDPOINTS.AUTH_REFRESH, { refreshToken })
    .then((response) => {
      const data = response.data?.data;
      if (!data?.accessToken) throw new Error('Malformed refresh response');
      setSession(data);
      return data.accessToken;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/* ---- Response Interceptor ---- */
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Retry once, but never for the credential endpoints themselves: a failed
    // login legitimately returns 401 and must surface to the caller, and
    // retrying /refresh would recurse. /api/auth/me is deliberately NOT in this
    // list — it is an ordinary authenticated read, and it is the first call made
    // after a reload, when only the refresh token survives.
    const CREDENTIAL_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];
    const isCredentialCall = typeof original?.url === 'string' && CREDENTIAL_PATHS.includes(original.url);
    if (status === 401 && original && !original._retried && !isCredentialCall) {
      original._retried = true;
      try {
        const token = await refreshAccessToken();
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return apiClient(original);
      } catch {
        clearSession();
      }
    }

    return Promise.reject(normalizeError(error));
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

export { normalizeError };
export default apiClient;
