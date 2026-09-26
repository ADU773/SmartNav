const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { installTestEnv, createTestUser } = require('./helpers/auth.cjs');

installTestEnv();

const Project = require('../models/Project');
const Scene = require('../models/Scene');
const Asset = require('../models/Asset');
const User = require('../models/User');
const { resolveUploadFile } = require('../services/fileCleanup');
const { setDetectorForTests, INPUT_SIZE } = require('../services/objectModel');
const { COCO_CLASSES } = require('../services/objectDetection');

/**
 * Stand-in for YOLOX: reports one confident laptop in the centre of every
 * view it is given. Real decoding, NMS, direction mapping and merging still
 * run on this output.
 */
function centreLaptopDetector({ gate, onCall } = {}) {
    const perAnchor = 5 + COCO_CLASSES.length;
    const anchors = [8, 16, 32].reduce((sum, s) => sum + (INPUT_SIZE / s) ** 2, 0);
    return async () => {
        onCall?.();
        if (gate) await gate;
        const out = new Float32Array(anchors * perAnchor);
        const cells = INPUT_SIZE / 8;
        const anchor = (cells / 2) * cells + cells / 2; // stride-8 cell at the image centre
        const o = anchor * perAnchor;
        out[o + 2] = Math.log(4); out[o + 3] = Math.log(4); // 32 px box
        out[o + 4] = 0.95;
        out[o + 5 + COCO_CLASSES.indexOf('laptop')] = 0.9;
        return out;
    };
}

test('object detection on scenes', { timeout: 240000 }, async (t) => {
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.17' } });
    const files = [];
    let listener;
    t.after(async () => {
        setDetectorForTests(null);
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await repl.stop();
        for (const file of files) await fs.unlink(resolveUploadFile(file)).catch(() => {});
    });
    await mongoose.connect(repl.getUri(), { dbName: 'smartnav_vision_test' });
    await Promise.all([Project, Scene, Asset, User].map((model) => model.init()));
    setDetectorForTests(centreLaptopDetector());

    const app = express();
    app.use(express.json());
    app.use('/api/vision', require('../routes/visionRoutes'));
    app.use('/api/scenes', require('../routes/sceneRoutes'));
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}/api`;
    const post = async (url, body, headers) => {
        const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    };

    const owner = await createTestUser({ email: 'vision-owner@example.com' });
    const intruder = await createTestUser({ email: 'vision-intruder@example.com' });
    const project = await Project.create({ name: 'Vision', ownerId: owner.user._id });

    const makePanorama = async () => {
        const filename = `vision-test-${randomUUID()}.png`;
        files.push(filename);
        await sharp({ create: { width: 800, height: 400, channels: 3, background: '#808080' } }).png().toFile(resolveUploadFile(filename));
        await Asset.create({ projectId: project._id, filename, path: `/uploads/${filename}` });
        return `/uploads/${filename}`;
    };
    const image = await makePanorama();
    const scene = await Scene.create({ projectId: project._id, name: 'Lab', image, metadata: ['kept-tag'] });

    await t.test('scans every direction, places each object, and tags the scene', async () => {
        const result = await post('/vision/detect', { sceneId: String(scene._id) }, owner.headers);
        assert.equal(result.status, 200);
        // One laptop at the centre of each view: 8 around the horizon, 45°
        // apart, and 4 in the ring looking 50° down. 12 distinct objects.
        assert.equal(result.body.data.viewsScanned, 12);
        assert.equal(result.body.data.detections.length, 12);
        assert.deepEqual(result.body.data.counts, [{ label: 'laptop', count: 12 }]);
        const yawsAt = (pitch) => result.body.data.detections
            .filter((d) => Math.round(d.pitchDeg) === pitch).map((d) => Math.round(d.yawDeg)).sort((a, b) => a - b);
        assert.deepEqual(yawsAt(0), [-135, -90, -45, 0, 45, 90, 135, 180]);
        assert.deepEqual(yawsAt(50), [-90, 0, 90, 180], 'pitch is positive downward, as the viewer expects');

        const saved = await Scene.findById(scene._id).lean();
        assert.equal(saved.detections.length, 12);
        assert.equal(saved.objectScan.image, image);
        assert.deepEqual(saved.metadata.sort(), ['kept-tag', 'laptop'], 'existing tags are kept');
    });

    await t.test('detections cannot be written through the scene API, and a new image clears them', async () => {
        const forged = await fetch(`${base}/scenes/${scene._id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', ...owner.headers },
            body: JSON.stringify({ detections: [{ label: 'unicorn' }] }),
        });
        assert.equal(forged.status, 400);

        const replacement = await makePanorama();
        const changed = await fetch(`${base}/scenes/${scene._id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', ...owner.headers },
            body: JSON.stringify({ image: replacement }),
        });
        assert.equal(changed.status, 200);
        const saved = await Scene.findById(scene._id).lean();
        assert.equal(saved.detections.length, 0, 'objects found in the old panorama no longer apply');
        assert.equal(saved.objectScan, undefined);
    });

    await t.test('owner only, and a scene needs a panorama', async () => {
        assert.equal((await post('/vision/detect', { sceneId: String(scene._id) })).status, 401);
        assert.equal((await post('/vision/detect', { sceneId: String(scene._id) }, intruder.headers)).status, 404);
        assert.equal((await post('/vision/detect', { sceneId: 'nope' }, owner.headers)).status, 400);
        const empty = await Scene.create({ projectId: project._id, name: 'No image' });
        assert.equal((await post('/vision/detect', { sceneId: String(empty._id) }, owner.headers)).status, 400);
    });

    await t.test('a panorama replaced during the scan does not receive the old results', async () => {
        const first = await makePanorama();
        const racing = await Scene.create({ projectId: project._id, name: 'Racing', image: first });
        let release;
        let started;
        const gate = new Promise((resolve) => { release = resolve; });
        const scanning = new Promise((resolve) => { started = resolve; });
        setDetectorForTests(centreLaptopDetector({ gate, onCall: () => started() }));
        try {
            const pending = post('/vision/detect', { sceneId: String(racing._id) }, owner.headers);
            await scanning;
            const second = await makePanorama();
            const changed = await fetch(`${base}/scenes/${racing._id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', ...owner.headers },
                body: JSON.stringify({ image: second }),
            });
            assert.equal(changed.status, 200);
            release();
            const result = await pending;
            assert.equal(result.status, 409);
            const saved = await Scene.findById(racing._id).lean();
            assert.equal(saved.image, second);
            assert.equal(saved.detections.length, 0);
            assert.equal(saved.objectScan, undefined);
            assert.ok(!saved.metadata.includes('laptop'));
        } finally {
            release();
            setDetectorForTests(centreLaptopDetector());
        }
    });

    await t.test('two scans of the same scene at once share one run', async () => {
        const busy = await Scene.create({ projectId: project._id, name: 'Busy', image: await makePanorama() });
        let calls = 0;
        setDetectorForTests(centreLaptopDetector({ onCall: () => { calls += 1; } }));
        try {
            const results = await Promise.all([1, 2].map(() => post('/vision/detect', { sceneId: String(busy._id) }, owner.headers)));
            assert.deepEqual(results.map((r) => r.status), [200, 200]);
            assert.equal(calls, 12, 'each view was run once, not once per request');
        } finally {
            setDetectorForTests(centreLaptopDetector());
        }
    });

    await t.test('an image that cannot be decoded is reported as such', async () => {
        const filename = `vision-test-${randomUUID()}.png`;
        files.push(filename);
        await fs.writeFile(resolveUploadFile(filename), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7)]));
        await Asset.create({ projectId: project._id, filename, path: `/uploads/${filename}` });
        const broken = await Scene.create({ projectId: project._id, name: 'Broken', image: `/uploads/${filename}` });
        const result = await post('/vision/detect', { sceneId: String(broken._id) }, owner.headers);
        assert.equal(result.status, 422);
    });

    await t.test('a remote detector gets a configured image link and its labels are cleaned', async () => {
        let received;
        const remote = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                received = JSON.parse(body);
                res.setHeader('Content-Type', 'application/json');
                // Ultralytics style: numeric class IDs, names in `name`; class 0 is "person".
                res.end(JSON.stringify({ results: [
                    { class: 0, name: 'person', confidence: 0.9 },
                    { class: 56, name: 'chair', score: 0.5 },
                    { label: '' },
                ] }));
            });
        });
        await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
        process.env.YOLO_API_URL = `http://127.0.0.1:${remote.address().port}/detect`;
        process.env.PUBLIC_API_URL = 'https://api.example.test/';
        try {
            const remoteScene = await Scene.create({ projectId: project._id, name: 'Remote', image: await makePanorama() });
            const result = await post('/vision/detect', { sceneId: String(remoteScene._id) }, { ...owner.headers, 'X-Forwarded-Host': 'attacker.example' });
            assert.equal(result.status, 200);
            assert.equal(received.imageUrl, `https://api.example.test${remoteScene.image}`);
            assert.deepEqual(result.body.data.labels, ['person', 'chair']);
            const saved = await Scene.findById(remoteScene._id).lean();
            assert.deepEqual(saved.detections.map((d) => [d.label, d.yawDeg]), [['person', null], ['chair', null]]);
        } finally {
            delete process.env.YOLO_API_URL;
            delete process.env.PUBLIC_API_URL;
            await new Promise((resolve) => remote.close(resolve));
        }
    });
});
