const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const express = require('express');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Project = require('../models/Project');
const Asset = require('../models/Asset');
const PanoramaSession = require('../models/PanoramaSession');

// Always isolated: never uses MONGODB_URI or the application's .env database.
test('panorama session upload metadata, idempotency and completion', { timeout: 240000 }, async (t) => {
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.17' } });
    let listener;
    t.after(async () => {
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await repl.stop();
    });
    await mongoose.connect(repl.getUri(), { dbName: 'smartnav_panorama_test' });
    await Promise.all([Project, Asset, PanoramaSession].map((model) => model.init()));

    const app = express();
    app.use(express.json());
    app.use('/api/panorama', require('../routes/panoramaRoutes'));
    app.use((error, req, res, _next) => res.status(400).json({ success: false, message: error.message }));
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}/api/panorama`;

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
    const upload = async (token, { frameId, sequence, yaw, pitch, roll } = {}) => {
        const form = new FormData();
        form.append('image', new File([png], 'frame.png', { type: 'image/png' }));
        if (frameId !== undefined) {
            form.append('metadata', JSON.stringify({ frameId, sequence, yaw, pitch, roll }));
        }
        const response = await fetch(`${base}/sessions/${token}/photos`, { method: 'POST', body: form });
        return { status: response.status, body: await response.json() };
    };

    const project = await Project.create({ name: 'Metadata Test Project' });

    await t.test('browser upload with no metadata still works', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        const result = await upload(token);
        assert.equal(result.status, 200);
        assert.equal(result.body.data.photos.length, 1);
        assert.equal(result.body.data.photos[0].frameId, undefined);
    });

    await t.test('native upload stores validated frame metadata', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        const result = await upload(token, { frameId: 'frame-1', sequence: 0, yaw: 90, pitch: 1.2, roll: -0.5 });
        assert.equal(result.status, 200);
        const photo = result.body.data.photos[0];
        assert.equal(photo.frameId, 'frame-1');
        assert.equal(photo.sequence, 0);
        assert.equal(photo.yaw, 90);
    });

    await t.test('retrying the same frameId is idempotent: no duplicate photo or Asset', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        await upload(token, { frameId: 'dup-frame', sequence: 0 });
        const before = await Asset.countDocuments({ projectId: project._id });
        const second = await upload(token, { frameId: 'dup-frame', sequence: 0 });
        assert.equal(second.status, 200);
        assert.equal(second.body.data.photos.length, 1);
        const after = await Asset.countDocuments({ projectId: project._id });
        assert.equal(after, before, 'no extra Asset should be created on a frameId retry');
    });

    await t.test('concurrent retries of the same frameId still produce exactly one photo', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        const results = await Promise.all([
            upload(token, { frameId: 'race-frame', sequence: 0 }),
            upload(token, { frameId: 'race-frame', sequence: 0 }),
            upload(token, { frameId: 'race-frame', sequence: 0 }),
        ]);
        results.forEach((r) => assert.equal(r.status, 200));
        const session = await PanoramaSession.findOne({ token });
        assert.equal(session.photos.filter((p) => p.frameId === 'race-frame').length, 1);
    });

    await t.test('uploads are rejected after completion, and completion is idempotent', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        await upload(token, { frameId: 'f1', sequence: 0 });
        await upload(token, { frameId: 'f2', sequence: 1 });
        const complete = async () => (await fetch(`${base}/sessions/${token}/complete`, { method: 'POST' })).json();
        const first = await complete();
        assert.equal(first.data.status, 'done');
        const second = await complete();
        assert.equal(second.data.status, 'done');
        const afterComplete = await upload(token, { frameId: 'f3', sequence: 2 });
        assert.equal(afterComplete.status, 400);
    });

    await t.test('rejects malformed metadata', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        const form = new FormData();
        form.append('image', new File([png], 'frame.png', { type: 'image/png' }));
        form.append('metadata', 'not-json');
        const response = await fetch(`${base}/sessions/${token}/photos`, { method: 'POST', body: form });
        assert.equal(response.status, 400);
    });
});
