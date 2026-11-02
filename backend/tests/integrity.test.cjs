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
            ['GET', `/analytics/projects/${p.id}`], ['POST', '/ai/chat'],
        ]) {
            assert.equal((await anon(method, url)).status, 401, `${method} ${url} must require authentication`);
        }
        // The share token is the one deliberate public read path, plus routes
        // inside a published tour (tested with the route finder below).
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

    await t.test('the chat assistant answers from the local model with the project as context', async () => {
        const chatModel = require('../services/ml/chatModel');
        const seen = [];
        process.env.LLM_PROVIDER = 'local';
        chatModel.setTestReply((input) => { seen.push(input); return 'Try scene B.'; });
        try {
            const { p, a } = await fixture();
            await Scene.updateOne({ _id: a.id }, { $set: { detections: [{ label: 'printer', confidence: 0.9 }, { label: 'printer', confidence: 0.8 }] } });
            const answer = await request('POST', '/ai/chat', { message: 'Where is the printer?', projectId: p.id });
            assert.equal(answer.status, 200);
            assert.equal(answer.body.data.reply, 'Try scene B.');
            assert.equal(seen.length, 1);
            assert.equal(seen[0].message, 'Where is the printer?');
            assert.match(seen[0].system, /for the project "Project P"/);
            assert.match(seen[0].system, /A \| leads to: nothing \| objects: printer x2/);
            assert.match(seen[0].system, /B \| leads to: A \(flat\) \| objects: none detected/);
            assert.deepEqual(Object.keys(seen[0].functions).sort(), ['find_object', 'find_route']);
            assert.deepEqual(seen[0].history, []);
            assert.equal((await request('POST', '/ai/chat', { message: '   ', projectId: p.id })).status, 400);
            // Another account cannot ask about this project's scenes.
            assert.equal((await requestAs(other)('POST', '/ai/chat', { message: 'hi', projectId: p.id })).status, 404);
            assert.equal(seen.length, 1);
        } finally {
            chatModel.setTestReply(null);
            delete process.env.LLM_PROVIDER;
        }
    });

    await t.test('the chat assistant follows the owner\'s saved instructions and the conversation so far', async () => {
        const chatModel = require('../services/ml/chatModel');
        const seen = [];
        process.env.LLM_PROVIDER = 'local';
        chatModel.setTestReply((input) => { seen.push(input); return 'ok'; });
        try {
            const { p } = await fixture();
            const saved = await request('PUT', `/projects/${p.id}`, { assistantInstructions: '  Reply in Malayalam.  ' });
            assert.equal(saved.status, 200);
            assert.equal(saved.body.data.assistantInstructions, 'Reply in Malayalam.');
            assert.equal((await request('PUT', `/projects/${p.id}`, { assistantInstructions: 'x'.repeat(1501) })).status, 400);
            assert.equal((await request('PUT', `/projects/${p.id}`, { assistantInstructions: 42 })).status, 400);
            // Only the owner can change them.
            assert.equal((await requestAs(other)('PUT', `/projects/${p.id}`, { assistantInstructions: 'Be rude.' })).status, 404);

            const history = [
                { role: 'assistant', content: 'dropped: replies to a question that was cut off' },
                { role: 'user', content: 'Route from A to B?' },
                { role: 'assistant', content: 'Go from A to B.' },
            ];
            assert.equal((await request('POST', '/ai/chat', { message: 'And back?', projectId: p.id, history })).status, 200);
            assert.match(seen[0].system, /owner's instructions[\s\S]*Reply in Malayalam\./);
            assert.deepEqual(seen[0].history, history.slice(1));
            for (const bad of ['text', [{ role: 'system', content: 'x' }], [{ role: 'user' }]]) {
                assert.equal((await request('POST', '/ai/chat', { message: 'hi', projectId: p.id, history: bad })).status, 400);
            }
        } finally {
            chatModel.setTestReply(null);
            delete process.env.LLM_PROVIDER;
        }
    });

    await t.test('the chat assistant\'s tools answer from the scene graph and the detections', async () => {
        const { chatFunctions } = require('../controllers/featureController');
        const { p, a, b } = await fixture();
        const lab = await Scene.create({ projectId: p._id, name: 'Computer Lab 2', image: a.image,
            detections: [{ label: 'laptop' }, { label: 'laptop' }, { label: 'chair' }] });
        // B -> A by stairs, A -> Lab by a ramp, B -> Lab directly by stairs.
        await Scene.updateOne({ _id: b._id }, { $set: { hotspots: [{ targetScene: a._id, access: 'stairs' }, { targetScene: lab._id, access: 'stairs', distance: 5 }] } });
        await Scene.updateOne({ _id: a._id }, { $set: { hotspots: [{ targetScene: lab._id, access: 'ramp' }] } });
        const tools = chatFunctions(p.id);

        const route = await tools.find_route.handler({ from: 'b', to: 'computer lab', step_free: false });
        assert.deepEqual(route.steps, ['Start at B', 'Go to A (stairs)', 'Go to Computer Lab 2 (ramp)']);
        const noStairs = await tools.find_route.handler({ from: 'B', to: 'Lab 2', step_free: true });
        assert.equal(noStairs.result, 'No step-free route exists between these scenes.');
        assert.equal((await tools.find_route.handler({ from: 'A', to: 'Lab', step_free: true })).steps.at(-1), 'Go to Computer Lab 2 (ramp)');
        const unknown = await tools.find_route.handler({ from: 'Cafeteria', to: 'A' });
        assert.match(unknown.error, /No scene matches "Cafeteria"/);

        assert.deepEqual((await tools.find_object.handler({ object: 'laptops' })).found, [{ scene: 'Computer Lab 2', count: 2 }]);
        assert.equal((await tools.find_object.handler({ object: 'printer' })).result, 'Not detected in any scene.');
        // Scenes of another project are never searched.
        assert.equal((await tools.find_route.handler({ from: 'C', to: 'A' })).error, 'No scene matches "C".');
    });

    await t.test('the chat assistant uses Gemini by default, runs its function calls and falls back when it is busy', async () => {
        const { p, a, b } = await fixture();
        await Scene.updateOne({ _id: a._id }, { $set: { detections: [{ label: 'laptop' }, { label: 'laptop' }] } });
        await Scene.updateOne({ _id: b._id }, { $set: { hotspots: [{ targetScene: a._id, access: 'ramp' }] } });
        const realFetch = globalThis.fetch;
        const savedKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'test-key';
        const savedOpenai = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        const calls = [];
        // Only Google is faked; the test's own requests to the API go through.
        globalThis.fetch = async (url, options) => {
            if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, options);
            const body = JSON.parse(options.body);
            calls.push({ url: String(url), key: options.headers['x-goog-api-key'], body });
            const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
            if (calls.length === 1) return json(503, { error: { message: 'This model is currently experiencing high demand.' } });
            const last = body.contents.at(-1);
            if (last.parts[0].functionResponse) {
                const { result } = last.parts[0].functionResponse.response;
                return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: `Route: ${result.steps.join(' > ')}` }] } }] });
            }
            return json(200, { candidates: [{ content: { role: 'model', parts: [
                { functionCall: { name: 'find_route', args: { from: 'B', to: 'A', step_free: true } }, thoughtSignature: 'sig' },
            ] } }] });
        };
        try {
            const answer = await request('POST', '/ai/chat', { message: 'Step-free route from B to A?', projectId: p.id,
                history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }] });
            assert.equal(answer.status, 200);
            assert.equal(answer.body.data.reply, 'Route: Start at B > Go to A (ramp)');
            assert.equal(answer.body.data.model, 'gemini-3.5-flash');
            // Busy primary model, then the fallback answers both rounds.
            assert.match(calls[0].url, /gemini-3\.5-flash:generateContent$/);
            assert.match(calls[1].url, /gemini-2\.5-flash:generateContent$/);
            assert.equal(calls.length, 3);
            // The key travels in a header, never in the URL.
            assert.ok(calls.every((call) => call.key === 'test-key' && !call.url.includes('test-key')));
            const first = calls[1].body;
            assert.match(first.systemInstruction.parts[0].text, /for the project "Project P"/);
            assert.deepEqual(first.contents.map((turn) => turn.role), ['user', 'model', 'user']);
            assert.deepEqual(first.tools[0].functionDeclarations.map((fn) => fn.name).sort(), ['find_object', 'find_route']);
            // The model's function-call turn is sent back unchanged, signature included.
            assert.equal(calls[2].body.contents.at(-2).parts[0].thoughtSignature, 'sig');

            delete process.env.GEMINI_API_KEY;
            const noKey = await request('POST', '/ai/chat', { message: 'hi', projectId: p.id });
            assert.equal(noKey.status, 503);
            assert.match(noKey.body.message, /GEMINI_API_KEY/);
        } finally {
            globalThis.fetch = realFetch;
            if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
            if (savedOpenai !== undefined) process.env.OPENAI_API_KEY = savedOpenai;
        }
    });

    await t.test('the chat assistant uses OpenAI when its key is set, and Gemini when OpenAI cannot answer', async () => {
        const { p, a, b } = await fixture();
        await Scene.updateOne({ _id: b._id }, { $set: { hotspots: [{ targetScene: a._id, access: 'door' }] } });
        const realFetch = globalThis.fetch;
        const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
        process.env.OPENAI_API_KEY = 'sk-test';
        delete process.env.GEMINI_API_KEY;
        let openaiCredit = true;
        const openaiCalls = [];
        let geminiCalls = 0;
        const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
        globalThis.fetch = async (url, options) => {
            if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
                geminiCalls += 1;
                return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini answer' }] } }] });
            }
            if (!String(url).startsWith('https://api.openai.com/')) return realFetch(url, options);
            const body = JSON.parse(options.body);
            openaiCalls.push({ auth: options.headers.Authorization, body });
            if (!openaiCredit) return json(429, { error: { message: 'You have no credits remaining.', type: 'insufficient_quota', code: 'credit_balance_exhausted' } });
            const last = body.messages.at(-1);
            if (last.role === 'tool') {
                const result = JSON.parse(last.content);
                return json(200, { choices: [{ message: { role: 'assistant', content: `Route: ${result.steps.join(' > ')}` } }] });
            }
            return json(200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'find_route', arguments: '{"from":"B","to":"A"}' } },
            ] } }] });
        };
        try {
            const answer = await request('POST', '/ai/chat', { message: 'Route from B to A?', projectId: p.id });
            assert.equal(answer.status, 200);
            assert.equal(answer.body.data.reply, 'Route: Start at B > Go to A (door)');
            assert.equal(answer.body.data.model, 'gpt-5.4-mini');
            assert.equal(openaiCalls.length, 2);
            assert.equal(openaiCalls[0].auth, 'Bearer sk-test');
            assert.equal(openaiCalls[0].body.model, 'gpt-5.4-mini');
            assert.equal(openaiCalls[0].body.messages[0].role, 'system');
            assert.deepEqual(openaiCalls[0].body.tools.map((tool) => tool.function.name).sort(), ['find_object', 'find_route']);
            // The assistant's tool call goes back before the tool result.
            assert.equal(openaiCalls[1].body.messages.at(-2).tool_calls[0].id, 'call_1');
            assert.equal(openaiCalls[1].body.messages.at(-1).tool_call_id, 'call_1');

            // No credits: not retried on the fallback model (same account).
            openaiCredit = false;
            openaiCalls.length = 0;
            const noCredit = await request('POST', '/ai/chat', { message: 'hi', projectId: p.id });
            assert.equal(noCredit.status, 502);
            assert.match(noCredit.body.message, /no credits/);
            assert.equal(openaiCalls.length, 1);

            // With a Gemini key as well, Gemini answers when OpenAI cannot.
            process.env.GEMINI_API_KEY = 'gemini-test';
            const fallback = await request('POST', '/ai/chat', { message: 'hi', projectId: p.id });
            assert.equal(fallback.status, 200);
            assert.equal(fallback.body.data.reply, 'Gemini answer');
            assert.equal(fallback.body.data.model, 'gemini-3.5-flash');
            assert.equal(geminiCalls, 1);
        } finally {
            globalThis.fetch = realFetch;
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key]; else process.env[key] = value;
            }
        }
    });

    await t.test('visitors of a published tour get routes without signing in, other tours stay private', async () => {
        const { p, q, a, b, c } = await fixture();
        const anonymous = requestAs({ headers: {} });
        const route = await anonymous('GET', `/navigation/path?projectId=${p.id}&fromSceneId=${b.id}&toSceneId=${a.id}`);
        assert.equal(route.status, 200);
        assert.deepEqual(route.body.data.path.map((step) => step.name), ['B', 'A']);
        // Project Q is not published: neither a visitor nor another account may route in it.
        assert.equal((await anonymous('GET', `/navigation/path?projectId=${q.id}&fromSceneId=${c.id}&toSceneId=${c.id}`)).status, 404);
        assert.equal((await requestAsIntruder('GET', `/navigation/path?projectId=${q.id}&fromSceneId=${c.id}&toSceneId=${c.id}`)).status, 404);
        assert.equal((await anonymous('GET', `/navigation/path?projectId=bad&fromSceneId=${b.id}&toSceneId=${a.id}`)).status, 400);
        // The owner still routes in an unpublished project.
        assert.notEqual((await request('GET', `/navigation/path?projectId=${q.id}&fromSceneId=${c.id}&toSceneId=${c.id}`)).status, 404);
    });

    await t.test('links drawn on the floor plan become hotspots in both scenes', async () => {
        const { p, a, b } = await fixture();
        // b already has a hand-placed hotspot to a (yaw 0, pitch 0, flat).
        const link = (from, body) => request('POST', `/scenes/${from}/link`, body);
        const notPlaced = await link(a.id, { targetSceneId: b.id });
        assert.equal(notPlaced.status, 400);
        assert.match(notPlaced.body.message, /Place "A" on the floor plan first/);

        assert.equal((await request('PUT', `/scenes/${a.id}`, { mapPosition: { x: 20, y: 50 } })).status, 200);
        assert.equal((await request('PUT', `/scenes/${b.id}`, { mapPosition: { x: 80, y: 50 } })).status, 200);
        assert.equal((await request('PUT', `/projects/${p.id}`, { floorPlanWidthMeters: 30 })).status, 200);
        assert.equal((await request('PUT', `/projects/${p.id}`, { floorPlanWidthMeters: -2 })).status, 400);

        // A has no direction and nothing to learn it from.
        const noDirection = await link(a.id, { targetSceneId: b.id });
        assert.equal(noDirection.status, 400);
        assert.match(noDirection.body.message, /Set the map direction of "A"/);
        assert.equal((await request('PUT', `/scenes/${a.id}`, { mapYawOffset: 'north' })).status, 400);
        assert.equal((await request('PUT', `/scenes/${a.id}`, { mapYawOffset: 0.5 })).status, 200);

        const linked = await link(a.id, { targetSceneId: b.id, access: 'door' });
        assert.equal(linked.status, 200);
        assert.equal(linked.body.data.distance, 18);
        assert.deepEqual(linked.body.data.directions, { A: 'set', B: 'existing hotspots' });
        const close = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} is not ${y}`);
        // A -> B points east on the map: 90° plus A's direction.
        const ab = linked.body.data.source.hotspots;
        assert.equal(ab.length, 1);
        close(ab[0].yaw, Math.PI / 2 + 0.5);
        assert.equal(ab[0].distance, 18);
        assert.equal(ab[0].access, 'door');
        close(ab[0].pitch, 0.12);
        // B -> A already existed: updated in place, its height kept. B's direction was
        // learned from that hotspot, so the recomputed yaw matches the hand-placed one.
        const ba = linked.body.data.target.hotspots;
        assert.equal(ba.length, 1);
        close(ba[0].yaw, 0);
        assert.equal(ba[0].pitch, 0);
        assert.equal(ba[0].access, 'door');

        // Linking again updates, never duplicates; one-way leaves the other scene alone.
        const again = await link(a.id, { targetSceneId: b.id, access: 'ramp', twoWay: false });
        assert.equal(again.status, 200);
        assert.equal(again.body.data.source.hotspots.length, 1);
        assert.equal((await Scene.findById(b.id).lean()).hotspots[0].access, 'door');
        // Another account cannot link this project's scenes.
        assert.equal((await requestAsIntruder('POST', `/scenes/${a.id}/link`, { targetSceneId: b.id })).status, 404);
        assert.equal((await link(a.id, { targetSceneId: a.id })).status, 400);
    });

    await t.test('the chat context stays within its budget on large projects', () => {
        const { chatContext } = require('../controllers/featureController');
        const labels = Array.from({ length: 500 }, (_, i) => ({ label: `object${i}` }));
        const scenes = Array.from({ length: 400 }, (_, i) => ({ _id: `s${i}`, name: `Scene ${i}`, hotspots: [], detections: labels }));
        const context = chatContext(scenes);
        assert.ok(context.length <= 12000 + 60, `context is ${context.length} characters`);
        assert.match(context, /\.\.\.and \d+ more scenes not listed\.$/);
        // At most 12 objects per scene, most frequent first, with counts.
        assert.equal(chatContext([{ _id: 's', name: 'S', detections: labels }]).split('objects: ')[1].split(', ').length, 12);
        assert.equal(chatContext([{ _id: 's', name: 'S', detections: [{ label: 'a' }, { label: 'b' }, { label: 'b' }] }]), '1. S | leads to: nothing | objects: b x2, a');
        assert.equal(chatContext([]), 'No scenes created yet.');
    });

    await t.test('unsupported transactions fail closed with a setup error', async (sub) => {
        sub.mock.method(mongoose.connection, 'transaction', async () => { throw Object.assign(new Error('Standalone MongoDB'), { code: 20 }); });
        await assert.rejects(transaction(async () => assert.fail('must not run')), (error) => error.status === 503 && /replica set/.test(error.message));
    });
});
