const runtime = require('../../config/runtime');

// Deterministic test environment. Installed before anything reads config, so
// token signing and verification agree without touching the developer's .env.
const TEST_ENV = {
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/smartnav-test',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
};

function installTestEnv(overrides = {}) {
    process.env.NODE_ENV = 'test';
    return runtime.init({ ...TEST_ENV, ...overrides });
}

/**
 * Creates a real user row and returns it with a signed access header.
 * @returns {Promise<{ user, headers: { Authorization: string } }>}
 */
async function createTestUser(overrides = {}) {
    installTestEnv();
    const User = require('../../models/User');
    const { signAccessToken, hashPassword } = require('../../services/auth');
    const suffix = Math.random().toString(36).slice(2, 10);
    const user = await User.create({
        email: overrides.email || `tester-${suffix}@example.com`,
        name: overrides.name || 'Test User',
        passwordHash: await hashPassword(overrides.password || 'correct-horse-battery'),
        role: overrides.role || 'admin',
    });
    return { user, headers: { Authorization: `Bearer ${signAccessToken(user)}` } };
}

module.exports = { TEST_ENV, installTestEnv, createTestUser };
