/**
 * SmartNav360 — Auth Service
 * Talks to the backend's JWT endpoints and keeps the token store in sync.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  setSession,
} from './tokenStore';

const AuthService = {
  /**
   * @param {{ email: string, password: string }} credentials
   * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
   */
  async login(credentials) {
    try {
      const { data } = await apiClient.post(API_ENDPOINTS.AUTH_LOGIN, {
        email: credentials.email,
        password: credentials.password,
      });
      setSession(data.data);
      return { success: true, data: data.data.user };
    } catch (error) {
      return { success: false, message: error.message || 'Sign-in failed.' };
    }
  },

  /**
   * @param {{ email: string, password: string, name: string }} details
   */
  async register(details) {
    try {
      const { data } = await apiClient.post(API_ENDPOINTS.AUTH_REGISTER, {
        email: details.email,
        password: details.password,
        name: details.name,
      });
      setSession(data.data);
      return { success: true, data: data.data.user };
    } catch (error) {
      return { success: false, message: error.message || 'Could not create the account.' };
    }
  },

  async logout() {
    const refreshToken = getRefreshToken();
    try {
      // Best effort: the local session is cleared regardless, so a network
      // failure can never leave the user apparently signed in.
      if (refreshToken) await apiClient.post(API_ENDPOINTS.AUTH_LOGOUT, { refreshToken });
    } catch {
      // Intentionally ignored.
    } finally {
      clearSession();
    }
    return { success: true };
  },

  /**
   * Re-reads the account from the server, which also validates the stored
   * session on app start.
   */
  async fetchCurrentUser() {
    try {
      const { data } = await apiClient.get(API_ENDPOINTS.AUTH_ME);
      setSession({ user: data.data });
      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  },

  getCurrentUser() {
    return getStoredUser();
  },

  isAuthenticated() {
    return !!(getAccessToken() || getRefreshToken());
  },
};

export default AuthService;
