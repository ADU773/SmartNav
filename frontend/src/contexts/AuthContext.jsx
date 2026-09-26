/**
 * SmartNav360 — Auth Context
 * Owns the signed-in account and exposes login/register/logout to the app.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AuthService from '../services/auth.service';
import { onSessionChange } from '../services/tokenStore';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => AuthService.getCurrentUser());
  const [loading, setLoading] = useState(false);
  // True until the stored session has been checked against the server, so the
  // router does not bounce a signed-in user to /login during that first call.
  const [initializing, setInitializing] = useState(() => AuthService.isAuthenticated());

  useEffect(() => {
    // The axios interceptor clears the store when a refresh finally fails;
    // mirror that here so the UI signs out without a reload.
    return onSessionChange((stored) => setUser(stored));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!AuthService.isAuthenticated()) {
      setInitializing(false);
      return () => { cancelled = true; };
    }
    AuthService.fetchCurrentUser()
      .then((result) => {
        if (cancelled) return;
        setUser(result.success ? result.data : null);
      })
      .finally(() => !cancelled && setInitializing(false));
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (credentials) => {
    setLoading(true);
    try {
      const result = await AuthService.login(credentials);
      if (result.success) setUser(result.data);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (details) => {
    setLoading(true);
    try {
      const result = await AuthService.register(details);
      if (result.success) setUser(result.data);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await AuthService.logout();
    setUser(null);
  }, []);

  const value = {
    user,
    loading,
    initializing,
    isAuthenticated: !!user,
    login,
    register,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * @returns {{ user, loading, initializing, isAuthenticated, login, register, logout }}
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
