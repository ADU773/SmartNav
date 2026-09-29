const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const mongoose = require('mongoose');
const express = require('express');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { installTestEnv, createTestUser } = require('./helpers/auth.cjs');

installTestEnv();

const User = require('../models/User');
const { setMatcherForTests, ensureModelFile, MODEL_EDGE } = require('../services/featureMatchModel');
const { matchFrames, modelSize } = require('../services/frameMatching');

/** A textured frame so real feature detectors have something to find. */
async function texturedFrame(width, height, seed) {
    const data = Buffer.alloc(width * height * 3);
    let state = seed;
    for (let i = 0; i < data.length; i += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        data[i] = (state >>> 24) & 0xff;
    }
    return sharp(data, { raw: { width, height, channels: 3 } }).blur(2).jpeg().toBuffer();
}

test('model sizes are multiples of 8 with the long edge at MODEL_EDGE', () => {
    assert.deepEqual(modelSize(1600, 1200), { width: MODEL_EDGE, height: 768 });
    assert.deepEqual(modelSize(900, 1600), { width: 576, height: MODEL_EDGE });
    assert.deepEqual(modelSize(320, 240), { width: 320, height: 240 }, 'small frames are not enlarged');
});

test('matches are returned in the uploaded frames\' own pixels', async () => {
    const calls = [];
    // 1600x1200 frames are matched at 1024x768, a factor of 1.5625 in each axis.
    setMatcherForTests(async (pixels, width, height) => {
        calls.push({ width, height, length: pixels.length });
        return {
            pointsA: [100, 200, 300, 400],
            pointsB: [50, 200, 250, 400],
            matches: [{ from: 0, to: 0, score: 0.9 }, { from: 1, to: 1, score: 0.05 }],
        };
    });
    try {
        const frames = await Promise.all([1, 2, 3].map((seed) => texturedFrame(1600, 1200, seed)));
        const result = await matchFrames(frames, [[0, 1], [1, 2]]);
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[0], { width: 1024, height: 768, length: 2 * 1024 * 768 });
        assert.deepEqual(result.frames, [{ width: 1600, height: 1200 }, { width: 1600, height: 1200 }, { width: 1600, height: 1200 }]);
        assert.equal(result.pairs[0].matches.length, 1, 'a low-confidence match is dropped');
        assert.deepEqual(result.pairs[0].matches[0], [156.25, 312.5, 78.125, 312.5, 0.9]);
    } finally {
        setMatcherForTests(null);
    }
});

test('the match endpoint', { timeout: 120000 }, async (t) => {
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.17' } });
    let listener;
    t.after(async () => {
        setMatcherForTests(null);
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await repl.stop();
    });
    await mongoose.connect(repl.getUri(), { dbName: 'smartnav_match_test' });
    await User.init();
    setMatcherForTests(async () => ({ pointsA: [10, 20], pointsB: [12, 20], matches: [{ from: 0, to: 0, score: 0.8 }] }));

    const app = express();
    app.use('/api/panorama', require('../routes/panoramaRoutes'));
    app.use((error, _req, res, _next) => res.status(error.status || 400).json({ success: false, message: error.message }));
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const url = `http://127.0.0.1:${listener.address().port}/api/panorama/match`;
    const owner = await createTestUser({ email: 'match-owner@example.com' });

    const frame = await texturedFrame(320, 240, 7);
    const form = (links, count = 2, type = 'image/jpeg') => {
        const body = new FormData();
        for (let i = 0; i < count; i += 1) body.append('image', new Blob([frame], { type }), `frame-${i}.jpg`);
        if (links !== undefined) body.append('links', typeof links === 'string' ? links : JSON.stringify(links));
        return body;
    };
    const post = async (body, headers = owner.headers) => {
        const response = await fetch(url, { method: 'POST', headers, body });
        return { status: response.status, body: await response.json() };
    };

    await t.test('requires a signed-in user', async () => {
        assert.equal((await post(form([[0, 1]]), {})).status, 401);
    });

    await t.test('returns matches for each requested pair', async () => {
        const result = await post(form([[0, 1]]));
        assert.equal(result.status, 200);
        assert.equal(result.body.data.matcher, 'superpoint-lightglue');
        assert.deepEqual(result.body.data.pairs, [{ from: 0, to: 1, matches: [[10, 20, 12, 20, 0.8]] }]);
    });

    await t.test('rejects bad requests', async () => {
        assert.equal((await post(form([[0, 1]], 1))).status, 400, 'one frame');
        assert.equal((await post(form([[0, 5]]))).status, 400, 'frame index out of range');
        assert.equal((await post(form([[1, 1]]))).status, 400, 'a frame matched to itself');
        assert.equal((await post(form('not json'))).status, 400);
        assert.equal((await post(form(undefined))).status, 400, 'missing links');
        assert.equal((await post(form([[0, 1]], 2, 'application/pdf'))).status, 400, 'not images');
    });

    await t.test('an undecodable frame is a 400, not a server error', async () => {
        const body = new FormData();
        body.append('image', new Blob([frame], { type: 'image/jpeg' }), 'a.jpg');
        body.append('image', new Blob([Buffer.from('not an image')], { type: 'image/jpeg' }), 'b.jpg');
        body.append('links', '[[0,1]]');
        assert.equal((await post(body)).status, 400);
    });
});

// Runs the real SuperPoint + LightGlue graph, so it only runs where the model
// has been fetched (`npm run models:fetch`).
const modelCached = fs.existsSync(require('node:path').join(__dirname, '..', '.cache', 'models', 'superpoint-lightglue.onnx'));
test('SuperPoint + LightGlue finds the shift between two crops of one image', { skip: !modelCached, timeout: 240000 }, async () => {
    await ensureModelFile();
    const width = 640;
    const height = 480;
    const shift = 60;
    const scene = await texturedFrame(width + shift, height, 11);
    const crop = (left) => sharp(scene).extract({ left, top: 0, width, height }).jpeg({ quality: 95 }).toBuffer();
    const { pairs } = await matchFrames([await crop(0), await crop(shift)], [[0, 1]]);

    const dx = pairs[0].matches.map(([x1, , x2]) => x1 - x2).sort((a, b) => a - b);
    assert.ok(dx.length >= 12, `expected at least 12 matches, got ${dx.length}`);
    assert.ok(Math.abs(dx[dx.length >> 1] - shift) <= 2, `median shift ${dx[dx.length >> 1]} should be about ${shift}`);
});
