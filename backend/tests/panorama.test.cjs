const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const express = require('express');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Project = require('../models/Project');
const Asset = require('../models/Asset');
const PanoramaSession = require('../models/PanoramaSession');
const Scene = require('../models/Scene');
const PendingFileDeletion = require('../models/PendingFileDeletion');
const fs = require('node:fs/promises');
const { resolveUploadFile } = require('../services/fileCleanup');
const User = require('../models/User');
const { installTestEnv, createTestUser } = require('./helpers/auth.cjs');

installTestEnv();

// Always isolated: never uses MONGODB_URI or the application's .env database.
test('panorama session upload metadata, idempotency and completion', { timeout: 240000 }, async (t) => {
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.17' } });
    let listener;
    t.after(async () => {
        if (listener) await new Promise((resolve) => listener.close(resolve));
        // Every Asset here lives only in this throwaway database, so its files
        // are test output: remove them rather than leave them in uploads/.
        if (mongoose.connection.readyState === 1) {
            for (const asset of await Asset.find().lean()) {
                for (const filename of [asset.filename, asset.thumbnailFilename].filter(Boolean)) {
                    await fs.unlink(resolveUploadFile(filename)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
                }
            }
        }
        await mongoose.disconnect();
        await repl.stop();
    });
    await mongoose.connect(repl.getUri(), { dbName: 'smartnav_panorama_test' });
    await Promise.all([Project, Asset, PanoramaSession, User, Scene, PendingFileDeletion].map((model) => model.init()));

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

    // Opening a session is owner-only; everything after it is authorised by
    // the session token alone, exactly as the phone uses it.
    const owner = await createTestUser({ email: 'panorama-owner@example.com' });
    const project = await Project.create({ name: 'Metadata Test Project', ownerId: owner.user._id });

    await t.test('browser upload with no metadata still works', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        const result = await upload(token);
        assert.equal(result.status, 200);
        assert.equal(result.body.data.photos.length, 1);
        assert.equal(result.body.data.photos[0].frameId, undefined);
    });

    await t.test('native upload stores validated frame metadata', async () => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ projectId: project._id }),
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
            method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ projectId: project._id }),
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
            method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ projectId: project._id }),
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
            method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ projectId: project._id }),
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
            method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        const form = new FormData();
        form.append('image', new File([png], 'frame.png', { type: 'image/png' }));
        form.append('metadata', 'not-json');
        const response = await fetch(`${base}/sessions/${token}/photos`, { method: 'POST', body: form });
        assert.equal(response.status, 400);
    });

    /* ---- finalize: keep the stitched panorama, delete the source photos ---- */

    const openSessionWithPhotos = async (count) => {
        const created = await (await fetch(`${base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...owner.headers }, body: JSON.stringify({ projectId: project._id }),
        })).json();
        const token = created.data.token;
        for (let i = 0; i < count; i += 1) await upload(token, { frameId: `f-${i}`, sequence: i, yaw: i * 30 });
        const session = await PanoramaSession.findOne({ token }).lean();
        return { token, photoIds: session.photos.map((photo) => String(photo.assetId)) };
    };
    // Stands in for the stitched result the viewer uploads through /api/upload.
    const makePanoramaAsset = async () => {
        const filename = `stitched-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        await fs.writeFile(resolveUploadFile(filename), png);
        return Asset.create({ projectId: project._id, filename, path: `/uploads/${filename}` });
    };
    const finalize = async (token, panoramaAssetId, headers = owner.headers) => {
        const response = await fetch(`${base}/sessions/${token}/finalize`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ panoramaAssetId }),
        });
        return { status: response.status, body: await response.json() };
    };
    const fileExists = (filename) => fs.stat(resolveUploadFile(filename)).then(() => true, () => false);

    await t.test('finalize deletes the source photos and their files, and keeps the panorama', async () => {
        const { token, photoIds } = await openSessionWithPhotos(3);
        const sources = await Asset.find({ _id: { $in: photoIds } }).lean();
        assert.equal(sources.length, 3);
        const panorama = await makePanoramaAsset();

        const result = await finalize(token, String(panorama._id));
        assert.equal(result.status, 200);
        assert.equal(result.body.data.deleted, 3);
        assert.deepEqual(result.body.data.kept, []);

        assert.equal(await Asset.countDocuments({ _id: { $in: photoIds } }), 0);
        for (const asset of sources) assert.equal(await fileExists(asset.filename), false, `${asset.filename} should be removed from disk`);
        assert.ok(await Asset.findById(panorama._id));
        assert.equal(await fileExists(panorama.filename), true);

        const session = await PanoramaSession.findOne({ token }).lean();
        assert.equal(session.status, 'done');
        assert.equal(session.photos.length, 0);
        assert.equal(String(session.panorama.assetId), String(panorama._id));
        assert.equal(session.panorama.sourceCount, 3);

        // The session is closed: the phone can no longer add to it.
        assert.equal((await upload(token, { frameId: 'late', sequence: 9 })).status, 400);
    });

    await t.test('finalize keeps a source photo that a scene already uses', async () => {
        const { token, photoIds } = await openSessionWithPhotos(2);
        const used = await Asset.findById(photoIds[0]).lean();
        await Scene.create({ projectId: project._id, name: 'Uses a raw frame', image: `http://localhost:5000${used.path}` });
        const panorama = await makePanoramaAsset();

        const result = await finalize(token, String(panorama._id));
        assert.equal(result.status, 200);
        assert.equal(result.body.data.deleted, 1);
        assert.deepEqual(result.body.data.kept, [{ assetId: photoIds[0], reason: 'used by a scene' }]);
        assert.ok(await Asset.findById(photoIds[0]));
        assert.equal(await Asset.exists({ _id: photoIds[1] }), null);
        // The kept photo stays listed on the session; only deleted ones are pulled.
        const session = await PanoramaSession.findOne({ token }).lean();
        assert.deepEqual(session.photos.map((photo) => String(photo.assetId)), [photoIds[0]]);
    });

    await t.test('finalize is owner-only, validates the panorama, and runs once', async () => {
        const { token, photoIds } = await openSessionWithPhotos(2);
        const panorama = await makePanoramaAsset();
        const intruder = await createTestUser({ email: `intruder-${Date.now()}@example.com` });

        // No token, and a signed-in non-owner: nothing is deleted either way.
        const anonymous = await fetch(`${base}/sessions/${token}/finalize`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panoramaAssetId: String(panorama._id) }),
        });
        assert.equal(anonymous.status, 401);
        assert.equal((await finalize(token, String(panorama._id), intruder.headers)).status, 404);

        // A panorama from another project is refused.
        const otherProject = await Project.create({ name: 'Other', ownerId: owner.user._id });
        const foreign = await Asset.create({ projectId: otherProject._id, filename: 'foreign.jpg', path: '/uploads/foreign.jpg' });
        assert.equal((await finalize(token, String(foreign._id))).status, 400);
        assert.equal(await Asset.countDocuments({ _id: { $in: photoIds } }), 2);

        assert.equal((await finalize(token, String(panorama._id))).status, 200);
        const second = await finalize(token, String(panorama._id));
        assert.equal(second.status, 409);
        assert.ok(await Asset.findById(panorama._id), 'a repeated finalize must never touch the panorama');
    });
});
