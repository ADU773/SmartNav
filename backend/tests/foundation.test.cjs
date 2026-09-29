const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { installTestEnv, createTestUser } = require('./helpers/auth.cjs');

installTestEnv();

const jobs = require('../services/jobs');
const modelStore = require('../services/modelStore');

test('model store downloads, verifies and caches weights', async (t) => {
    const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'smartnav-models-'));
    const saved = process.env.MODEL_CACHE_DIR;
    process.env.MODEL_CACHE_DIR = cacheDir;
    const body = Buffer.from('pretend weights');
    let requests = 0;
    const server = http.createServer((req, res) => {
        requests += 1;
        if (req.url === '/bad') return res.end('tampered');
        res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        if (saved === undefined) delete process.env.MODEL_CACHE_DIR; else process.env.MODEL_CACHE_DIR = saved;
        await new Promise((resolve) => server.close(resolve));
        await fsp.rm(cacheDir, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');

    const good = modelStore.defineModel({
        id: 'test-good', label: 'Test model', version: 'v1', gpu: false,
        files: { model: { name: 'good.bin', url: `${base}/good`, sha256 } },
    });
    assert.equal(good.isCached(), false);
    const paths = await good.ensureFiles();
    assert.equal(paths.model, path.join(cacheDir, 'good.bin'));
    assert.deepEqual(fs.readFileSync(paths.model), body);
    await good.ensureFiles();
    assert.equal(requests, 1, 'a verified file is not downloaded again');
    assert.equal(good.isCached(), true);
    assert.ok(modelStore.status().some((entry) => entry.id === 'test-good' && entry.cached));

    const bad = modelStore.defineModel({
        id: 'test-bad', label: 'Tampered model', version: 'v1', gpu: false,
        files: { model: { name: 'bad.bin', url: `${base}/bad`, sha256 } },
    });
    await assert.rejects(bad.ensureFiles(), /failed its checksum/);
    assert.equal(fs.existsSync(path.join(cacheDir, 'bad.bin')), false, 'a failed download leaves nothing behind');
    assert.deepEqual(fs.readdirSync(cacheDir).filter((name) => name.endsWith('.tmp')), []);

    // A missing model is reported as unavailable (503), naming the fetch command.
    await assert.rejects(bad.session(), (error) => error.status === 503 && /models:fetch test-bad/.test(error.message));
});

test('background jobs', async (t) => {
    t.afterEach(() => jobs.resetForTests());

    await t.test('run, report progress and keep their result', async () => {
        jobs.defineJob('test-double', async (payload, { progress }) => {
            progress(50, 'halfway');
            return { doubled: payload.value * 2 };
        });
        const job = jobs.enqueue('test-double', { value: 21 }, { ownerId: 'alice' });
        assert.equal(job.status, 'queued');
        const done = await jobs.waitFor(job.id);
        assert.equal(done.status, 'done');
        assert.deepEqual(done.result, { doubled: 42 });
        assert.equal(done.progress, 100);
        assert.equal(jobs.getJob(job.id, 'bob'), null, 'another user cannot see it');
        assert.equal(jobs.getJob(job.id, 'alice').status, 'done');
    });

    await t.test('report failures with their status', async () => {
        jobs.defineJob('test-fail', async () => { throw Object.assign(new Error('bad input'), { status: 422 }); });
        const done = await jobs.waitFor(jobs.enqueue('test-fail', {}).id);
        assert.equal(done.status, 'failed');
        assert.deepEqual(done.error, { message: 'bad input', status: 422 });
    });

    await t.test('run one at a time, share duplicates, and turn away a crowd', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        let running = 0;
        let peak = 0;
        jobs.defineJob('test-slow', async () => {
            running += 1; peak = Math.max(peak, running);
            await gate;
            running -= 1;
            return 'ok';
        }, { concurrency: 1, maxWaiting: 2 });
        const first = jobs.enqueue('test-slow', {}, { dedupeKey: 'same' });
        assert.equal(jobs.enqueue('test-slow', {}, { dedupeKey: 'same' }).id, first.id);
        await new Promise((resolve) => setImmediate(resolve));
        const second = jobs.enqueue('test-slow', {});
        const third = jobs.enqueue('test-slow', {});
        assert.throws(() => jobs.enqueue('test-slow', {}), (error) => error.status === 503);
        release();
        await Promise.all([first, second, third].map((job) => jobs.waitFor(job.id)));
        assert.equal(peak, 1);
    });
});

test('job and model status routes', { timeout: 120000 }, async (t) => {
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    const mongoose = require('mongoose');
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.17' } });
    let listener;
    t.after(async () => {
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await repl.stop();
        jobs.resetForTests();
    });
    await mongoose.connect(repl.getUri(), { dbName: 'smartnav_foundation_test' });
    await require('../models/User').init();
    const app = express();
    app.use('/api', require('../routes/systemRoutes'));
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}/api`;
    const owner = await createTestUser({ email: 'jobs-owner@example.com' });
    const other = await createTestUser({ email: 'jobs-other@example.com' });

    jobs.defineJob('test-route', async () => ({ answer: 42 }));
    const job = jobs.enqueue('test-route', {}, { ownerId: String(owner.user._id) });
    await jobs.waitFor(job.id);

    const get = (url, headers) => fetch(base + url, { headers }).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal((await get(`/jobs/${job.id}`, {})).status, 401);
    assert.equal((await get(`/jobs/${job.id}`, other.headers)).status, 404);
    assert.equal((await get('/jobs/not-an-id', owner.headers)).status, 404);
    const mine = await get(`/jobs/${job.id}`, owner.headers);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.data.result, { answer: 42 });

    const models = await get('/system/models', owner.headers);
    assert.equal(models.status, 200);
    assert.ok(Array.isArray(models.body.data));
});
