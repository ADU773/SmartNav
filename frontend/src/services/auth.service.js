/**
 * SmartNav360 — Auth Service (Placeholder)
 * Architecture-ready for JWT authentication.
 * Replace placeholder logic with real backend calls when auth is implemented.
 */

// import apiClient from './api';
// import { API_ENDPOINTS } from '../constants/api';

const STORAGE_KEY = 'smartnav360_user';

const AuthService = {
  /**
   * Placeholder login.
   * Replace with: apiClient.post(API_ENDPOINTS.AUTH_LOGIN, credentials)
   */
  async login(credentials) {
    const { email, password } = credentials;

    // Placeholder: accept any non-empty credentials
    if (email && password) {
      const user = {
        id: 'placeholder-user-id',
        email,
        name: email.split('@')[0],
        role: 'admin',
        avatar: null,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      return { success: true, data: user };
    }

    return { success: false, message: 'Invalid credentials' };
  },

  /**
   * Placeholder logout.
   * Replace with: apiClient.post(API_ENDPOINTS.AUTH_LOGOUT)
   */
  async logout() {
    localStorage.removeItem(STORAGE_KEY);
    return { success: true };
  },

  /**
   * Get current user from storage.
   * Replace with: apiClient.get(API_ENDPOINTS.AUTH_ME)
   */
  getCurrentUser() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  /**
   * Check if a user is currently logged in.
   */
  isAuthenticated() {
    return !!this.getCurrentUser();
  },
};

export default AuthService;
