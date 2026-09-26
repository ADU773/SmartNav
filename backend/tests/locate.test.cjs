const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const sharp = require('sharp');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { installTestEnv, createTestUser } = require('./helpers/auth.cjs');

installTestEnv();

const Project = require('../models/Project');
const Scene = require('../models/Scene');
const SceneEmbedding = require('../models/SceneEmbedding');
const User = require('../models/User');
const { resolveUploadFile } = require('../services/fileCleanup');
const { setEmbedderForTests } = require('../services/placeModel');
const { renderView } = require('../services/placeRecognition');

/**
 * Stand-in for DINOv2: the mean colour of each cell in a 6x6 grid, centred
 * and normalised. Crude, but it changes with both the scene and the direction
 * a view faces, which is all the pipeline under test needs.
 */
function colourLayoutEmbedder(pixels) {
    const size = Math.round(Math.sqrt(pixels.length / 3));
    const grid = 6;
    const out = new Float32Array(grid * grid * 3);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const cell = (Math.floor((y * grid) / size) * grid + Math.floor((x * grid) / size)) * 3;
            const i = (y * size + x) * 3;
            for (let c = 0; c < 3; c += 1) out[cell + c] += pixels[i + c] - 128;
        }
    }
    const norm = Math.hypot(...out) || 1;
    return out.map((v) => v / norm);
}

/** A panorama whose colour changes with longitude, in a scene-specific way. */
async function writePanorama(filename, colourAt) {
    const width = 720, height = 360;
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = colourAt(x / width, y / height);
            const i = (y * width + x) * 3;
            rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
        }
    }
    await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toFile(resolveUploadFile(filename));
    return { rgb, width, height };
}

test('Where am I: locating a photo within a project', { timeout: 240000 }, async (t) => {
    const server = await MongoMemoryServer.create({ binary: { version: '8.0.17' } });
    const files = [];
    let listener;
    t.after(async () => {
        setEmbedderForTests(null);
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await server.stop();
        for (const file of files) await fs.unlink(resolveUploadFile(file)).catch(() => {});
    });
    await mongoose.connect(server.getUri(), { dbName: 'smartnav_locate_test' });
    await Promise.all([Project, Scene, SceneEmbedding, User].map((model) => model.init()));
    setEmbedderForTests(colourLayoutEmbedder);

    const app = express();
    app.use(express.json());
    app.use('/api/locate', require('../routes/locateRoutes'));
    app.use((error, _req, res, _next) => res.status(400).json({ success: false, message: error.message }));
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}/api/locate`;

    const owner = await createTestUser({ email: 'locate-owner@example.com' });
    const intruder = await createTestUser({ email: 'locate-intruder@example.com' });
    const shareToken = randomUUID().replace(/-/g, '');
    const project = await Project.create({ name: 'Campus', ownerId: owner.user._id, published: true, shareToken });

    const name = (label) => { const f = `locate-test-${label}-${randomUUID()}.png`; files.push(f); return f; };
    const sunsetFile = name('sunset');
    const sunset = await writePanorama(sunsetFile, (u, v) => [Math.round(255 * u), 60, Math.round(255 * (1 - u) * v)]);
    const seaFile = name('sea');
    await writePanorama(seaFile, (u, v) => [30, Math.round(255 * Math.abs(Math.sin(u * Math.PI * 3))), Math.round(200 * v + 40)]);

    const sunsetScene = await Scene.create({ projectId: project._id, name: 'Sunset hall', image: `/uploads/${sunsetFile}` });
    const seaScene = await Scene.create({ projectId: project._id, name: 'Sea room', image: `/uploads/${seaFile}` });

    // A "photo" taken in the sunset hall facing 90° right.
    const view = renderView(sunset.rgb, sunset.width, sunset.height, { yawDeg: 90, size: 224 });
    const photo = await sharp(Buffer.from(view.pixels), { raw: { width: 224, height: 224, channels: 3 } }).jpeg().toBuffer();

    const locate = async (fields, headers = {}, body = photo) => {
        const form = new FormData();
        if (body) form.append('image', new File([body], 'photo.jpg', { type: 'image/jpeg' }));
        for (const [key, value] of Object.entries(fields)) form.append(key, value);
        const response = await fetch(base, { method: 'POST', body: form, headers });
        return { status: response.status, body: await response.json() };
    };

    await t.test('finds the right scene and the direction the visitor faces', async () => {
        const result = await locate({ projectId: String(project._id) }, owner.headers);
        assert.equal(result.status, 200);
        const [best] = result.body.data.matches;
        assert.equal(best.name, 'Sunset hall');
        assert.equal(best.sceneId, String(sunsetScene._id));
        assert.ok(Math.abs(best.yawDeg - 90) <= 10, `heading ${best.yawDeg} should be near 90`);
        assert.equal(result.body.data.indexedScenes, 2);
        assert.equal(result.body.data.newlyIndexed, 2, 'the first request builds the index');
        assert.equal(await SceneEmbedding.countDocuments({ projectId: project._id }), 2);
    });

    await t.test('reuses the index instead of rebuilding it', async () => {
        const result = await locate({ projectId: String(project._id) }, owner.headers);
        assert.equal(result.status, 200);
        assert.equal(result.body.data.newlyIndexed, 0);
    });

    await t.test('a published tour can be located anonymously by its share token', async () => {
        const result = await locate({ shareToken });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.matches[0].name, 'Sunset hall');
    });

    await t.test('access rules: no token, wrong owner, unpublished share, bad upload', async () => {
        assert.equal((await locate({ projectId: String(project._id) })).status, 401);
        assert.equal((await locate({ projectId: String(project._id) }, intruder.headers)).status, 404);
        assert.equal((await locate({ shareToken: 'f'.repeat(32) })).status, 404);
        await Project.updateOne({ _id: project._id }, { $set: { published: false } });
        assert.equal((await locate({ shareToken })).status, 404, 'unpublishing revokes anonymous access');
        await Project.updateOne({ _id: project._id }, { $set: { published: true } });
        assert.equal((await locate({ projectId: String(project._id) }, owner.headers, null)).status, 400);
        assert.equal((await locate({ projectId: String(project._id) }, owner.headers, Buffer.from('not an image'))).status, 400);
    });

    await t.test('a scene whose image changes is re-indexed; a deleted one leaves the index', async () => {
        const replacement = name('replacement');
        await writePanorama(replacement, (u) => [200, 200, Math.round(255 * u)]);
        await Scene.updateOne({ _id: seaScene._id }, { $set: { image: `/uploads/${replacement}` } });

        const status = await (await fetch(`${base}/projects/${project._id}/status`, { headers: owner.headers })).json();
        assert.deepEqual(status.data, { scenesWithImages: 2, indexed: 1, pending: 1 });

        const rebuilt = await (await fetch(`${base}/projects/${project._id}/index`, { method: 'POST', headers: owner.headers })).json();
        assert.equal(rebuilt.data.newlyIndexed, 1);

        await Scene.deleteOne({ _id: seaScene._id });
        await fetch(`${base}/projects/${project._id}/index`, { method: 'POST', headers: owner.headers });
        assert.equal(await SceneEmbedding.exists({ sceneId: seaScene._id }), null);
        assert.equal(await SceneEmbedding.countDocuments({ projectId: project._id }), 1);

        assert.equal((await fetch(`${base}/projects/${project._id}/index`, { method: 'POST', headers: intruder.headers })).status, 404);
    });
});
