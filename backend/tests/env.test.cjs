const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEnv } = require('../config/env');

const base = { MONGODB_URI: 'mongodb://localhost/smartnav' };

test('a setting left blank in .env counts as not set', () => {
    // .env.example ships with empty optional lines such as "YOLO_API_URL=".
    const env = loadEnv({ ...base, YOLO_API_URL: '', PUBLIC_API_URL: '', GEMINI_API_KEY: '' });
    assert.equal(env.YOLO_API_URL, undefined);
    assert.equal(env.PUBLIC_API_URL, undefined);
    assert.equal(env.GEMINI_API_KEY, undefined);
});

test('optional URLs are still validated when given', () => {
    assert.throws(() => loadEnv({ ...base, YOLO_API_URL: 'not a url' }), /YOLO_API_URL/);
    assert.equal(loadEnv({ ...base, PUBLIC_API_URL: 'https://api.example.test' }).PUBLIC_API_URL, 'https://api.example.test');
});

test('required settings left blank are reported by name', () => {
    assert.throws(() => loadEnv({ MONGODB_URI: '' }), /MONGODB_URI is required/);
    assert.throws(
        () => loadEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '' }),
        /JWT_ACCESS_SECRET is required[\s\S]*JWT_REFRESH_SECRET is required/,
    );
    assert.equal(loadEnv({ MONGODB_URI: '', MONGO_URI: 'mongodb://h/db' }).MONGODB_URI, 'mongodb://h/db', 'the MONGO_URI alias still applies');
});

test('production still refuses the development secrets', () => {
    assert.throws(() => loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'development-only-insecure-secret-change-me-access',
        JWT_REFRESH_SECRET: 'x'.repeat(40),
    }), /development default/);
});
