const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Project = require('../models/Project');
const Scene = require('../models/Scene');
const Asset = require('../models/Asset');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const PendingFileDeletion = require('../models/PendingFileDeletion');
const User = require('../models/User');
const { processPendingFiles, resolveUploadFile } = require('../services/fileCleanup');
const { transaction } = require('../services/integrity');
const { installTestEnv, createTestUser } = require('./helpers/auth.cjs');

installTestEnv();

// Always isolated: never uses MONGODB_URI or the application's .env database.
test('entity integrity against a real isolated MongoDB replica set', { timeout: 240000 }, async (t) => {
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.17' } });
    const files = new Set();
    let listener;
    t.after(async () => {
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await repl.stop();
        // Delete only test-owned UUID files, never the uploads directory.
        for (const filename of files) await fs.unlink(resolveUploadFile(filename)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    });
    await mongoose.connect(repl.getUri(), { dbName: 'smartnav_integrity_test' });
    const models = [Project, Scene, Asset, AnalyticsEvent, PendingFileDeletion, User];
    await Promise.all(models.map((model) => model.init()));
    const app = express();
    app.use(express.json());
    app.use('/api/projects', require('../routes/projectRoutes'));
    app.use('/api/scenes', require('../routes/sceneRoutes'));
    app.use('/api/upload', require('../routes/uploadRoutes'));
    app.use('/api', require('../routes/featureRoutes'));
    app.use((error, req, res, _next) => res.status(400).json({ success: false, message: error.message }));
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}/api`;

    // Every route below is owner-scoped now, so the suite runs as a real
    // signed-in account. `other` exists to prove cross-tenant isolation.
    const owner = await createTestUser({ email: 'owner@example.com' });
    const other = await createTestUser({ email: 'intruder@example.com' });

    const requestAs = (auth) => async (method, url, data) => {
        const response = await fetch(base + url, {
            method,
            headers: { 'Content-Type': 'application/json', ...auth.headers },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return { status: response.status, body: await response.json() };
    };
    const request = requestAs(owner);
    const requestAsIntruder = requestAs(other);
    const missing = () => String(new mongoose.Types.ObjectId());
    const makeAsset = async (projectId) => {
        const filename = `integrity-test-${randomUUID()}.png`;
        files.add(filename);
        await fs.mkdir(path.dirname(resolveUploadFile(filename)), { recursive: true });
        await fs.writeFile(resolveUploadFile(filename), Buffer.from('test-owned file'), { flag: 'wx' });
        return Asset.create({ projectId, filename, path: `/uploads/${filename}` });
    };
    const fixture = async () => {
        // Users are recreated per fixture below, so exclude them from the wipe.
        for (const model of models.filter((model) => model !== User)) await model.deleteMany({});
        const p = await Project.create({ name: 'Project P', ownerId: owner.user._id, published: true, shareToken: randomUUID().replace(/-/g, '') });
        const q = await Project.create({ name: 'Project Q', ownerId: owner.user._id });
        const asset = await makeAsset(p._id);
        const otherAsset = await makeAsset(q._id);
        const a = await Scene.create({ projectId: p._id, name: 'A', image: asset.path });
        const b = await Scene.create({ projectId: p._id, name: 'B', image: asset.path, hotspots: [{ targetScene: a._id }] });
        const c = await Scene.create({ projectId: q._id, name: 'C', image: otherAsset.path });
        return { p, q, asset, otherAsset, a, b, c };
    };

    await t.test('creates scenes only for existing projects and owned image assets', async () => {
        const { p, asset, otherAsset } = await fixture();
        assert.equal((await request('POST', '/scenes', { projectId: 'bad', name: 'Invalid' })).status, 400);
        assert.equal((await request('POST', '/scenes', { projectId: missing(), name: 'Missing' })).status, 404);
        for (const image of [otherAsset.path, '/uploads/missing.png', '/uploads/../secret']) {
            assert.equal((await request('POST', '/scenes', { projectId: p.id, name: 'Bad asset', image })).status, 400);
        }
        const created = await request('POST', '/scenes', { projectId: p.id, name: 'Created', image: `http://localhost:5000${asset.path}` });
        assert.equal(created.status, 201);
        assert.equal(created.body.data.image, asset.path);
        assert.equal(await Scene.countDocuments({ name: 'Bad asset' }), 0);
    });

    await t.test('connections reject invalid, foreign, self, duplicate and invalid-distance targets', async () => {
        const { a, b, c } = await fixture();
        for (const targetSceneId of ['bad', missing(), c.id, a.id]) {
            assert.equal((await request('POST', `/scenes/${a.id}/connect`, { targetSceneId })).status, 400);
        }
        for (const distance of [-1, 'NaN']) assert.equal((await request('POST', `/scenes/${a.id}/connect`, { targetSceneId: b.id, distance })).status, 400);
        const results = await Promise.all([1, 2].map(() => request('POST', `/scenes/${a.id}/connect`, { targetSceneId: b.id, distance: 5 })));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
        assert.equal((await Scene.findById(a.id)).hotspots.length, 1);
    });

    await t.test('updates validate replacement hotspots and forbid project moves or operator bypasses', async () => {
        const { p, q, a, b, c, asset, otherAsset } = await fixture();
        for (const data of [
            { projectId: q.id }, { $set: { projectId: q.id } }, { _id: missing() },
            { hotspots: [{ targetScene: c.id }] }, { hotspots: [{ targetScene: missing() }] },
            { hotspots: [{ targetScene: a.id }] }, { hotspots: [{ targetScene: b.id }, { targetScene: b.id }] },
            { image: otherAsset.path },
        ]) assert.equal((await request('PUT', `/scenes/${a.id}`, data)).status, 400);
        assert.equal((await request('PUT', `/scenes/${a.id}`, { projectId: p.id, image: asset.path, mapPosition: { x: 40, y: 60 }, hotspots: [{ targetScene: b.id, distance: 2 }] })).status, 200);
        assert.equal((await request('PUT', `/scenes/${a.id}`, { hotspots: [] })).status, 200);
        assert.equal((await Scene.findById(a.id)).hotspots.length, 0);
        assert.equal((await request('PUT', `/projects/${p.id}`, { floorPlan: otherAsset.path })).status, 400);
        assert.equal((await request('PUT', `/projects/${p.id}`, { floorPlan: asset.path })).status, 200);
        assert.equal((await request('PUT', `/projects/${p.id}`, { $unset: { name: 1 } })).status, 400);
        assert.equal((await request('PUT', `/projects/${p.id}`, { shareToken: 'injected' })).status, 400);
        assert.equal((await request('PUT', `/projects/${p.id}`, { floorPlan: '' })).status, 200);
    });

    await t.test('scene deletion removes all incoming hotspots and analytics but retains reusable assets', async () => {
        const { p, q, a, b, c, asset } = await fixture();
        await Scene.updateOne({ _id: c.id }, { $push: { hotspots: { targetScene: a.id } } });
        await AnalyticsEvent.create([
            { projectId: p.id, sceneId: a.id, type: 'view' },
            { projectId: p.id, sceneId: b.id, type: 'navigation', metadata: { fromSceneId: a.id } },
            { projectId: q.id, sceneId: c.id, type: 'view' },
        ]);
        assert.equal((await request('DELETE', `/scenes/${a.id}`)).status, 200);
        assert.equal(await Scene.findById(a.id), null);
        assert.equal(await Scene.countDocuments({ 'hotspots.targetScene': a.id }), 0);
        assert.equal(await AnalyticsEvent.countDocuments(), 1);
        assert.ok(await Asset.findById(asset.id));
        assert.ok(await fs.stat(resolveUploadFile(asset.filename)));
        assert.equal((await request('DELETE', `/scenes/${a.id}`)).status, 404);
    });

    await t.test('scene deletion rolls back incoming references on a database failure', async (sub) => {
        const { a, b } = await fixture();
        sub.mock.method(AnalyticsEvent, 'deleteMany', async () => { throw new Error('Injected database failure'); });
        assert.equal((await request('DELETE', `/scenes/${a.id}`)).status, 500);
        assert.ok(await Scene.findById(a.id));
        assert.equal(String((await Scene.findById(b.id)).hotspots[0].targetScene), a.id);
    });

    await t.test('project deletion cascades data/files and repairs legacy cross-project references', async () => {
        const { p, q, a, c, asset, otherAsset } = await fixture();
        await Scene.updateOne({ _id: c.id }, { $set: { image: `http://localhost:5000${asset.path}` }, $push: { hotspots: { targetScene: a.id } } });
        await Project.updateOne({ _id: q.id }, { $set: { floorPlan: asset.path } });
        await AnalyticsEvent.create([
            { projectId: p.id, sceneId: a.id, type: 'view' },
            { projectId: q.id, sceneId: c.id, type: 'navigation', metadata: { fromSceneId: a.id } },
            { projectId: q.id, sceneId: c.id, type: 'view' },
        ]);
        const result = await request('DELETE', `/projects/${p.id}`);
        assert.equal(result.status, 200);
        assert.equal(await Project.findById(p.id), null);
        assert.equal(await Scene.countDocuments({ projectId: p.id }), 0);
        assert.equal(await Asset.countDocuments({ projectId: p.id }), 0);
        assert.equal(await AnalyticsEvent.countDocuments(), 1);
        assert.equal((await Scene.findById(c.id)).image, '');
        assert.equal((await Scene.findById(c.id)).hotspots.length, 0);
        assert.equal((await Project.findById(q.id)).floorPlan, '');
        await assert.rejects(fs.stat(resolveUploadFile(asset.filename)), { code: 'ENOENT' });
        assert.ok(await fs.stat(resolveUploadFile(otherAsset.filename)));
        assert.equal(await PendingFileDeletion.countDocuments(), 0);
        assert.equal((await request('GET', `/published/${p.shareToken}`)).status, 404);
        assert.equal((await request('DELETE', `/projects/${p.id}`)).status, 404);
    });

    await t.test('project deletion failure rolls back every collection and leaves files untouched', async (sub) => {
        const { p, q, a, c, asset } = await fixture();
        await Scene.updateOne({ _id: c.id }, { $push: { hotspots: { targetScene: a.id } } });
        await Project.updateOne({ _id: q.id }, { $set: { floorPlan: asset.path } });
        await AnalyticsEvent.create({ projectId: p.id, sceneId: a.id, type: 'view' });
        sub.mock.method(Asset, 'deleteMany', async () => { throw new Error('Injected deletion failure'); });
        assert.equal((await request('DELETE', `/projects/${p.id}`)).status, 500);
        assert.ok(await Project.findById(p.id));
        assert.equal(await Scene.countDocuments({ projectId: p.id }), 2);
        assert.ok(await Asset.findById(asset.id));
        assert.equal(await AnalyticsEvent.countDocuments({ projectId: p.id }), 1);
        assert.equal((await Scene.findById(c.id)).hotspots.length, 1);
        assert.equal((await Project.findById(q.id)).floorPlan, asset.path);
        assert.equal(await PendingFileDeletion.countDocuments(), 0);
        assert.ok(await fs.stat(resolveUploadFile(asset.filename)));
    });

    await t.test('filesystem failure leaves a durable retry job; missing files are safe on retry', async (sub) => {
        const { p, asset } = await fixture();
        const unlink = fs.unlink;
        const mocked = sub.mock.method(fs, 'unlink', async (filename) => {
            if (filename === resolveUploadFile(asset.filename)) throw Object.assign(new Error('Injected file lock'), { code: 'EPERM' });
            return unlink(filename);
        });
        const result = await request('DELETE', `/projects/${p.id}`);
        assert.equal(result.status, 200);
        assert.equal(result.body.cleanupPending, true);
        assert.equal(await Project.findById(p.id), null);
        assert.equal(await PendingFileDeletion.countDocuments(), 1);
        mocked.mock.restore();
        await fs.unlink(resolveUploadFile(asset.filename));
        await PendingFileDeletion.updateMany({}, { $set: { retryAt: new Date(0) } });
        await processPendingFiles();
        assert.equal(await PendingFileDeletion.countDocuments(), 0);
    });

    await t.test('legacy shared files survive and unsafe cleanup paths never escape uploads', async () => {
        const { p, q, asset } = await fixture();
        await Asset.create({ projectId: q.id, filename: asset.filename, path: asset.path });
        await Project.updateOne({ _id: q.id }, { $set: { floorPlan: asset.path } });
        assert.equal((await request('DELETE', `/projects/${p.id}`)).status, 200);
        assert.ok(await fs.stat(resolveUploadFile(asset.filename)));
        assert.equal((await Project.findById(q.id)).floorPlan, asset.path);
        for (const value of ['../server.js', '..\\server.js', 'C:\\secret', '/tmp/file', '..']) assert.throws(() => resolveUploadFile(value));
    });

    await t.test('analytics rejects missing, cross-project and deleted references', async () => {
        const { p, a, c } = await fixture();
        for (const data of [
            { projectId: 'bad', type: 'view' }, { projectId: missing(), type: 'view' },
            { projectId: p.id, sceneId: c.id, type: 'view' },
            { projectId: p.id, sceneId: a.id, type: 'navigation', metadata: { fromSceneId: missing() } },
        ]) assert.ok([400, 404].includes((await request('POST', '/analytics/events', data)).status));
        assert.equal((await request('POST', '/analytics/events', { projectId: p.id, sceneId: a.id, type: 'view' })).status, 201);
        await request('DELETE', `/scenes/${a.id}`);
        assert.equal((await request('POST', '/analytics/events', { projectId: p.id, sceneId: a.id, type: 'view' })).status, 400);
        assert.equal(await AnalyticsEvent.countDocuments(), 0);
    });

    await t.test('connections and scene creation racing deletion never leave orphans', async () => {
        const { p, a, b } = await fixture();
        const results = await Promise.all([
            request('POST', `/scenes/${a.id}/connect`, { targetSceneId: b.id }),
            request('DELETE', `/scenes/${b.id}`),
        ]);
        assert.equal(results[1].status, 200);
        assert.ok([200, 400, 404].includes(results[0].status));
        assert.equal(await Scene.countDocuments({ 'hotspots.targetScene': b.id }), 0);
        const race = await Promise.all([
            request('POST', '/scenes', { projectId: p.id, name: 'Racing scene' }),
            request('DELETE', `/projects/${p.id}`),
            request('POST', '/analytics/events', { projectId: p.id, sceneId: a.id, type: 'view' }),
        ]);
        assert.equal(race[1].status, 200);
        assert.ok([201, 404].includes(race[0].status));
        assert.equal(await Scene.countDocuments({ projectId: p.id }), 0);
        assert.equal(await AnalyticsEvent.countDocuments({ projectId: p.id }), 0);
    });

    await t.test('upload persistence racing project deletion never leaves an asset orphan', async () => {
        const { p } = await fixture();
        const form = new FormData();
        form.append('projectId', p.id);
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
        form.append('image', new File([png], 'race.png', { type: 'image/png' }));
        const [uploadResponse, deletion] = await Promise.all([
            fetch(`${base}/upload`, { method: 'POST', body: form, headers: owner.headers }), request('DELETE', `/projects/${p.id}`),
        ]);
        const result = await uploadResponse.json();
        assert.ok([200, 404].includes(uploadResponse.status));
        if (result.data) files.add(result.data.filename);
        assert.equal(deletion.status, 200);
        assert.equal(await Asset.countDocuments({ projectId: p.id }), 0);
        if (result.data) await assert.rejects(fs.stat(resolveUploadFile(result.data.filename)), { code: 'ENOENT' });
    });

    await t.test('another account cannot read or modify a project it does not own', async () => {
        const { p, a, asset } = await fixture();
        // Every cross-tenant attempt must look exactly like "does not exist",
        // so ownership is never leaked through a 403 vs 404 distinction.
        assert.equal((await requestAsIntruder('GET', `/projects/${p.id}`)).status, 404);
        assert.equal((await requestAsIntruder('PUT', `/projects/${p.id}`, { name: 'Stolen' })).status, 404);
        assert.equal((await requestAsIntruder('DELETE', `/projects/${p.id}`)).status, 404);
        assert.equal((await requestAsIntruder('GET', `/scenes/${a.id}`)).status, 404);
        assert.equal((await requestAsIntruder('PUT', `/scenes/${a.id}`, { name: 'Stolen' })).status, 404);
        assert.equal((await requestAsIntruder('DELETE', `/scenes/${a.id}`)).status, 404);
        assert.equal((await requestAsIntruder('GET', `/scenes?projectId=${p.id}`)).status, 404);
        assert.equal((await requestAsIntruder('POST', '/scenes', { projectId: p.id, name: 'Injected' })).status, 404);
        assert.equal((await requestAsIntruder('GET', `/upload?projectId=${p.id}`)).status, 404);
        assert.equal((await requestAsIntruder('DELETE', `/upload/${asset.id}`)).status, 404);
        assert.equal((await requestAsIntruder('GET', `/analytics/projects/${p.id}`)).status, 404);
        assert.equal((await requestAsIntruder('POST', `/projects/${p.id}/publish`)).status, 404);
        assert.equal((await requestAsIntruder('GET', `/projects/${p.id}/export`)).status, 404);
        // Nothing was actually changed by any of the above.
        assert.ok(await Project.findById(p.id));
        assert.equal((await Project.findById(p.id)).name, 'Project P');
        assert.ok(await Scene.findById(a.id));
        assert.ok(await Asset.findById(asset.id));
        // The intruder's own project list stays empty.
        assert.deepEqual((await requestAsIntruder('GET', '/projects')).body.data, []);
    });

    await t.test('an unauthenticated request reaches nothing except the public share link', async () => {
        const { p, a } = await fixture();
        const anon = async (method, url, data) => {
            const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
            return { status: response.status, body: await response.json() };
        };
        for (const [method, url] of [
            ['GET', '/projects'], ['POST', '/projects'], ['GET', `/projects/${p.id}`],
            ['PUT', `/projects/${p.id}`], ['DELETE', `/projects/${p.id}`],
            ['GET', `/scenes?projectId=${p.id}`], ['POST', '/scenes'], ['GET', `/scenes/${a.id}`],
            ['GET', `/upload?projectId=${p.id}`],
            ['GET', `/analytics/projects/${p.id}`], ['GET', '/navigation/path'], ['POST', '/ai/chat'],
        ]) {
            assert.equal((await anon(method, url)).status, 401, `${method} ${url} must require authentication`);
        }
        // The share token is the one deliberate public read path.
        const shared = await anon('GET', `/published/${p.shareToken}`);
        assert.equal(shared.status, 200);
        assert.equal(shared.body.data.project.name, 'Project P');
        // ...and it must not expose who owns the project.
        assert.equal(shared.body.data.project.ownerId, undefined);
        assert.equal((await anon('GET', '/published/not-a-real-token')).status, 404);
    });

    await t.test('routes avoid stairs on request and weight them when not avoided', async () => {
        const { p, a, b } = await fixture();
        // a -> b directly by stairs, and a -> detour -> b on the flat.
        const detour = await Scene.create({ projectId: p._id, name: 'Detour' });
        await Scene.updateOne({ _id: a.id }, { $set: { hotspots: [
            { targetScene: b._id, distance: 1, access: 'stairs' },
            { targetScene: detour._id, distance: 2, access: 'flat' },
        ] } });
        await Scene.updateOne({ _id: detour._id }, { $set: { hotspots: [{ targetScene: b._id, distance: 2, access: 'flat' }] } });

        const direct = await request('GET', `/navigation/path?projectId=${p.id}&fromSceneId=${a.id}&toSceneId=${b.id}`);
        assert.equal(direct.status, 200);
        assert.deepEqual(direct.body.data.path.map((step) => step.name), ['A', 'B']);

        const stepFree = await request('GET', `/navigation/path?projectId=${p.id}&fromSceneId=${a.id}&toSceneId=${b.id}&avoid=stairs`);
        assert.equal(stepFree.status, 200);
        assert.deepEqual(stepFree.body.data.path.map((step) => step.name), ['A', 'Detour', 'B']);
        assert.ok(stepFree.body.data.path.every((step) => step.access !== 'stairs'));

        // With the only flat detour removed, a step-free route no longer exists.
        await Scene.updateOne({ _id: detour._id }, { $set: { hotspots: [] } });
        const impossible = await request('GET', `/navigation/path?projectId=${p.id}&fromSceneId=${a.id}&toSceneId=${b.id}&avoid=stairs`);
        assert.equal(impossible.status, 404);
        assert.match(impossible.body.message, /avoiding stairs/);

        assert.equal((await request('GET', `/navigation/path?projectId=${p.id}&fromSceneId=${a.id}&toSceneId=${b.id}&avoid=escalatorz`)).status, 400);
    });

    await t.test('list endpoints paginate instead of returning everything', async () => {
        const { p } = await fixture();
        await Scene.deleteMany({ projectId: p._id });
        await Scene.insertMany(Array.from({ length: 7 }, (_, i) => ({ projectId: p._id, name: `Scene ${i}` })));
        const firstPage = await request('GET', `/scenes?projectId=${p.id}&limit=3`);
        assert.equal(firstPage.status, 200);
        assert.equal(firstPage.body.data.length, 3);
        assert.deepEqual(firstPage.body.meta, { page: 1, limit: 3, total: 7, pages: 3, hasMore: true });
        const lastPage = await request('GET', `/scenes?projectId=${p.id}&limit=3&page=3`);
        assert.equal(lastPage.body.data.length, 1);
        assert.equal(lastPage.body.meta.hasMore, false);
        // An absurd limit is clamped rather than honoured.
        assert.equal((await request('GET', `/scenes?projectId=${p.id}&limit=99999`)).body.meta.limit, 200);
    });

    await t.test('unsupported transactions fail closed with a setup error', async (sub) => {
        sub.mock.method(mongoose.connection, 'transaction', async () => { throw Object.assign(new Error('Standalone MongoDB'), { code: 20 }); });
        await assert.rejects(transaction(async () => assert.fail('must not run')), (error) => error.status === 503 && /replica set/.test(error.message));
    });
});
