import { describe, it, expect, beforeEach, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import apiClient, { refreshClient } from '../api';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  setSession,
} from '../tokenStore';

describe('tokenStore', () => {
  beforeEach(() => clearSession());

  it('keeps the access token in memory and the refresh token in storage', () => {
    setSession({ user: { id: '1', name: 'Ada' }, accessToken: 'access-1', refreshToken: 'refresh-1' });

    expect(getAccessToken()).toBe('access-1');
    expect(getRefreshToken()).toBe('refresh-1');
    // The access token must never be written to disk.
    expect(localStorage.getItem('smartnav360_refresh')).toBe('refresh-1');
    expect(JSON.stringify(localStorage)).not.toContain('access-1');
  });

  it('clears everything on sign-out', () => {
    setSession({ user: { id: '1' }, accessToken: 'a', refreshToken: 'r' });
    clearSession();

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('survives unreadable storage instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked in a private window');
    });

    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });
});

describe('apiClient', () => {
  /** @type {MockAdapter} */
  let mock;
  /** @type {MockAdapter} */
  let refreshMock;

  beforeEach(() => {
    clearSession();
    mock = new MockAdapter(apiClient);
    // Refresh goes through its own axios instance to avoid recursing through
    // this interceptor, so it needs its own adapter.
    refreshMock = new MockAdapter(refreshClient);
  });

  it('attaches the bearer token to outgoing requests', async () => {
    setSession({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    mock.onGet('/api/projects').reply((config) => [200, { seen: config.headers.Authorization }]);

    const response = await apiClient.get('/api/projects');
    expect(response.data.seen).toBe('Bearer access-1');
  });

  it('sends no Authorization header when signed out', async () => {
    mock.onGet('/api/projects').reply((config) => [200, { seen: config.headers.Authorization ?? null }]);

    const response = await apiClient.get('/api/projects');
    expect(response.data.seen).toBeNull();
  });

  it('surfaces the server message rather than a generic one', async () => {
    mock.onGet('/api/projects').reply(400, { message: 'A valid project ID is required.' });

    await expect(apiClient.get('/api/projects')).rejects.toMatchObject({
      status: 400,
      message: 'A valid project ID is required.',
    });
  });

  it('does not retry a failed login, so bad credentials surface to the caller', async () => {
    setSession({ accessToken: 'expired', refreshToken: 'refresh-1' });
    mock.onPost('/api/auth/login').reply(401, { message: 'Email or password is incorrect.' });

    await expect(apiClient.post('/api/auth/login', {})).rejects.toMatchObject({
      status: 401,
      message: 'Email or password is incorrect.',
    });
    // The refresh endpoint must not have been involved.
    expect(refreshMock.history.post).toHaveLength(0);
  });

  it('refreshes and retries /api/auth/me, which is how a reload restores the session', async () => {
    // After a reload only the refresh token survives; the first /me call goes
    // out unauthenticated and must trigger a refresh rather than a sign-out.
    setSession({ refreshToken: 'refresh-1' });
    let seenAuthorization = null;
    mock.onGet('/api/auth/me').reply((config) => {
      seenAuthorization = config.headers.Authorization ?? null;
      return seenAuthorization === 'Bearer fresh-access'
        ? [200, { data: { id: '1', name: 'Ada' } }]
        : [401, { message: 'Sign in to continue.' }];
    });
    refreshMock.onPost('/api/auth/refresh').reply(200, {
      data: { user: { id: '1', name: 'Ada' }, accessToken: 'fresh-access', refreshToken: 'refresh-2' },
    });

    const response = await apiClient.get('/api/auth/me');

    expect(response.data.data.name).toBe('Ada');
    expect(getAccessToken()).toBe('fresh-access');
    expect(getRefreshToken()).toBe('refresh-2');
  });

  it('signs out when the refresh itself fails', async () => {
    setSession({ user: { id: '1' }, accessToken: 'expired', refreshToken: 'stale' });
    mock.onGet('/api/projects').reply(401, { message: 'Sign in to continue.' });
    refreshMock.onPost('/api/auth/refresh').reply(401, { message: 'Your session has expired.' });

    await expect(apiClient.get('/api/projects')).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('rotates the refresh token once for several simultaneous 401s', async () => {
    setSession({ accessToken: 'expired', refreshToken: 'refresh-1' });
    let refreshCalls = 0;
    mock.onGet(/\/api\/scenes|\/api\/projects|\/api\/upload/).reply((config) =>
      config.headers.Authorization === 'Bearer fresh-access' ? [200, { ok: true }] : [401, { message: 'expired' }]
    );
    refreshMock.onPost('/api/auth/refresh').reply(() => {
      refreshCalls += 1;
      return [200, { data: { user: { id: '1' }, accessToken: 'fresh-access', refreshToken: 'refresh-2' } }];
    });

    const responses = await Promise.all([
      apiClient.get('/api/scenes'),
      apiClient.get('/api/projects'),
      apiClient.get('/api/upload'),
    ]);

    expect(responses.every((response) => response.data.ok)).toBe(true);
    // Rotating three times would trip the server's replay detection.
    expect(refreshCalls).toBe(1);
  });
});
