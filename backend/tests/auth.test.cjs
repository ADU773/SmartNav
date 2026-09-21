const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { installTestEnv } = require('./helpers/auth.cjs');

installTestEnv();

const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const authRoutes = require('../routes/authRoutes');
const { verifyAccessToken } = require('../services/auth');

// Auth needs no transactions, so a standalone server is enough here.
test('authentication: registration, sign-in, rotation and revocation', { timeout: 240000 }, async (t) => {
    const server = await MongoMemoryServer.create({ binary: { version: '8.0.17' } });
    let listener;
    t.after(async () => {
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await server.stop();
    });
    await mongoose.connect(server.getUri(), { dbName: 'smartnav_auth_test' });
    await Promise.all([User.init(), RefreshToken.init()]);

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}/api/auth`;

    const request = async (method, url, data, headers = {}) => {
        const response = await fetch(base + url, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return { status: response.status, body: await response.json() };
    };

    const reset = async () => {
        await User.deleteMany({});
        await RefreshToken.deleteMany({});
    };

    await t.test('rejects weak or malformed registration details', async () => {
        await reset();
        for (const body of [
            {}, { email: 'not-an-email', password: 'longenough1', name: 'A' },
            { email: 'a@example.com', password: 'short', name: 'A' },
            { email: 'a@example.com', password: 'longenough1' },
        ]) {
            assert.equal((await request('POST', '/register', body)).status, 400);
        }
        assert.equal(await User.countDocuments(), 0);
    });

    await t.test('registers the first account as administrator and never returns the hash', async () => {
        await reset();
        const created = await request('POST', '/register', { email: 'First@Example.com', password: 'correct-horse', name: 'Ada' });
        assert.equal(created.status, 201);
        assert.equal(created.body.data.user.role, 'admin');
        // Email is normalized so sign-in is not case-sensitive.
        assert.equal(created.body.data.user.email, 'first@example.com');
        assert.ok(created.body.data.accessToken);
        assert.ok(created.body.data.refreshToken);
        assert.equal(created.body.data.user.passwordHash, undefined);
        assert.equal(JSON.stringify(created.body).includes('correct-horse'), false);

        // The stored password must be a bcrypt hash, not the plaintext.
        const stored = await User.findOne({ email: 'first@example.com' }).select('+passwordHash');
        assert.match(stored.passwordHash, /^\$2[aby]\$\d{2}\$/);
        assert.notEqual(stored.passwordHash, 'correct-horse');

        // Subsequent accounts are ordinary members.
        const second = await request('POST', '/register', { email: 'second@example.com', password: 'correct-horse', name: 'Bob' });
        assert.equal(second.body.data.user.role, 'member');
    });

    await t.test('refuses a duplicate email', async () => {
        await reset();
        await request('POST', '/register', { email: 'dup@example.com', password: 'correct-horse', name: 'A' });
        const again = await request('POST', '/register', { email: 'DUP@example.com', password: 'correct-horse', name: 'B' });
        assert.equal(again.status, 409);
        assert.equal(await User.countDocuments(), 1);
    });

    await t.test('signs in with the right password and gives nothing away with the wrong one', async () => {
        await reset();
        await request('POST', '/register', { email: 'user@example.com', password: 'correct-horse', name: 'A' });

        const good = await request('POST', '/login', { email: 'USER@example.com', password: 'correct-horse' });
        assert.equal(good.status, 200);
        assert.equal(verifyAccessToken(good.body.data.accessToken).email, 'user@example.com');

        const wrongPassword = await request('POST', '/login', { email: 'user@example.com', password: 'wrong' });
        const unknownEmail = await request('POST', '/login', { email: 'nobody@example.com', password: 'correct-horse' });
        assert.equal(wrongPassword.status, 401);
        assert.equal(unknownEmail.status, 401);
        // Identical wording, so the response cannot be used to enumerate accounts.
        assert.equal(wrongPassword.body.message, unknownEmail.body.message);
    });

    await t.test('/me requires a valid token and returns the account', async () => {
        await reset();
        const session = (await request('POST', '/register', { email: 'me@example.com', password: 'correct-horse', name: 'Ada' })).body.data;

        assert.equal((await request('GET', '/me')).status, 401);
        assert.equal((await request('GET', '/me', undefined, { Authorization: 'Bearer not-a-token' })).status, 401);
        assert.equal((await request('GET', '/me', undefined, { Authorization: session.accessToken })).status, 401);

        const me = await request('GET', '/me', undefined, { Authorization: `Bearer ${session.accessToken}` });
        assert.equal(me.status, 200);
        assert.equal(me.body.data.email, 'me@example.com');
        assert.equal(me.body.data.passwordHash, undefined);
    });

    await t.test('a deleted account cannot keep using an unexpired token', async () => {
        await reset();
        const session = (await request('POST', '/register', { email: 'gone@example.com', password: 'correct-horse', name: 'A' })).body.data;
        assert.equal((await request('GET', '/me', undefined, { Authorization: `Bearer ${session.accessToken}` })).status, 200);

        await User.deleteMany({ email: 'gone@example.com' });
        assert.equal((await request('GET', '/me', undefined, { Authorization: `Bearer ${session.accessToken}` })).status, 401);
    });

    await t.test('refresh rotates the token and stores only hashes', async () => {
        await reset();
        const session = (await request('POST', '/register', { email: 'rotate@example.com', password: 'correct-horse', name: 'A' })).body.data;

        const refreshed = await request('POST', '/refresh', { refreshToken: session.refreshToken });
        assert.equal(refreshed.status, 200);
        assert.notEqual(refreshed.body.data.refreshToken, session.refreshToken);
        assert.ok(refreshed.body.data.accessToken);

        // The raw token must never be persisted.
        const rows = await RefreshToken.find().lean();
        assert.equal(rows.length, 2);
        for (const row of rows) {
            assert.match(row.tokenHash, /^[a-f0-9]{64}$/);
            assert.notEqual(row.tokenHash, session.refreshToken);
        }

        // The new token still works.
        assert.equal((await request('POST', '/refresh', { refreshToken: refreshed.body.data.refreshToken })).status, 200);
    });

    await t.test('replaying a rotated refresh token revokes the whole family', async () => {
        await reset();
        const session = (await request('POST', '/register', { email: 'replay@example.com', password: 'correct-horse', name: 'A' })).body.data;
        const rotated = (await request('POST', '/refresh', { refreshToken: session.refreshToken })).body.data;

        // Reusing the already-rotated token is the classic theft signature.
        assert.equal((await request('POST', '/refresh', { refreshToken: session.refreshToken })).status, 401);

        // ...so the token issued by that rotation is dead too.
        assert.equal((await request('POST', '/refresh', { refreshToken: rotated.refreshToken })).status, 401);
        assert.equal(await RefreshToken.countDocuments({ revokedAt: null }), 0);
    });

    await t.test('logout revokes only the session that signed out', async () => {
        await reset();
        const a = (await request('POST', '/register', { email: 'multi@example.com', password: 'correct-horse', name: 'A' })).body.data;
        const b = (await request('POST', '/login', { email: 'multi@example.com', password: 'correct-horse' })).body.data;

        assert.equal((await request('POST', '/logout', { refreshToken: a.refreshToken })).status, 200);
        assert.equal((await request('POST', '/refresh', { refreshToken: a.refreshToken })).status, 401);
        // The other device stays signed in.
        assert.equal((await request('POST', '/refresh', { refreshToken: b.refreshToken })).status, 200);
    });

    await t.test('rejects a refresh token signed with the wrong secret', async () => {
        await reset();
        const jwt = require('jsonwebtoken');
        const forged = jwt.sign({ sub: String(new mongoose.Types.ObjectId()) }, 'a-different-secret-entirely-0000000000', { expiresIn: '30d', issuer: 'smartnav360' });
        assert.equal((await request('POST', '/refresh', { refreshToken: forged })).status, 401);
        assert.equal((await request('POST', '/refresh', {})).status, 400);
    });
});
