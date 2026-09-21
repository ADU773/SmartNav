/**
 * SmartNav360 — Token Store
 * Holds the access/refresh pair for the signed-in session.
 *
 * The access token is kept in memory so it never touches disk; the refresh
 * token persists so a reload does not sign the user out. Every storage call is
 * guarded because private windows and blocked site data make localStorage throw
 * rather than simply return null.
 */

const REFRESH_KEY = 'smartnav360_refresh';
const USER_KEY = 'smartnav360_user';

let accessToken = null;
const listeners = new Set();

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A session that cannot persist still works until the tab closes.
  }
}

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
}

export function getRefreshToken() {
  return readStorage(REFRESH_KEY);
}

export function setRefreshToken(token) {
  writeStorage(REFRESH_KEY, token || null);
}

export function getStoredUser() {
  const raw = readStorage(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  writeStorage(USER_KEY, user ? JSON.stringify(user) : null);
}

/** Stores a complete session returned by login/register/refresh. */
export function setSession({ user, accessToken: access, refreshToken }) {
  setAccessToken(access);
  if (refreshToken !== undefined) setRefreshToken(refreshToken);
  if (user !== undefined) setStoredUser(user);
  notify();
}

export function clearSession() {
  setAccessToken(null);
  setRefreshToken(null);
  setStoredUser(null);
  notify();
}

/**
 * Notifies subscribers that the session changed. The axios interceptor clears
 * the session on an unrecoverable 401, and AuthContext needs to react to that
 * without the two importing each other.
 */
function notify() {
  listeners.forEach((listener) => listener(getStoredUser()));
}

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
