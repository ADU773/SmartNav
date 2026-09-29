const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { installTestEnv, createTestUser } = require('./helpers/auth.cjs');

installTestEnv();

const Project = require('../models/Project');
const Asset = require('../models/Asset');
const User = require('../models/User');
const PendingFileDeletion = require('../models/PendingFileDeletion');
const { resolveUploadFile, processPendingFiles } = require('../services/fileCleanup');
const { setInpainterForTests } = require('../services/ml/inpaintModel');
const { blankGeneratedPixels } = require('../services/generatedPixels');
const jobs = require('../services/jobs');

/** Stand-in for LaMa: paints every missing pixel mid-grey. */
const greyInpainter = async (rgb, mask) => {
    const out = Uint8Array.from(rgb);
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) out.fill(128, i * 3, i * 3 + 3);
    return out;
};

test('filling a panorama\'s gaps', { timeout: 300000 }, async (t) => {
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '8.0.17' } });
    const files = [];
    let listener;
    t.after(async () => {
        setInpainterForTests(null);
        if (listener) await new Promise((resolve) => listener.close(resolve));
        await mongoose.disconnect();
        await repl.stop();
        for (const file of files) await fs.unlink(resolveUploadFile(file)).catch(() => {});
    });
    await mongoose.connect(repl.getUri(), { dbName: 'smartnav_fill_test' });
    await Promise.all([Project, Asset, User, PendingFileDeletion].map((model) => model.init()));
    setInpainterForTests(greyInpainter);

    const app = express();
    app.use(express.json());
    app.use('/api/upload', require('../routes/uploadRoutes'));
    app.use('/api', require('../routes/systemRoutes'));
    listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}/api`;

    const owner = await createTestUser({ email: 'fill-owner@example.com' });
    const intruder = await createTestUser({ email: 'fill-intruder@example.com' });
    const project = await Project.create({ name: 'Fill', ownerId: owner.user._id });

    // 1024 x 512 panorama: a photographed band around the horizon, black above and below.
    const filename = `fill-test-${randomUUID()}.jpg`;
    files.push(filename);
    const raw = Buffer.alloc(1024 * 512 * 3);
    for (let y = 200; y < 312; y += 1) raw.fill(170, y * 1024 * 3, (y + 1) * 1024 * 3);
    await sharp(raw, { raw: { width: 1024, height: 512, channels: 3 } }).jpeg({ quality: 95 }).toFile(resolveUploadFile(filename));
    const source = await Asset.create({ projectId: project._id, filename, path: `/uploads/${filename}`, originalName: 'room.jpg' });
    const originalBytes = await fs.readFile(resolveUploadFile(filename));

    const post = (id, headers) => fetch(`${base}/upload/${id}/fill`, { method: 'POST', headers });

    await t.test('only the owner can fill', async () => {
        assert.equal((await post(source._id)).status, 401);
        assert.equal((await post(source._id, intruder.headers)).status, 404);
        assert.equal((await post('nope', owner.headers)).status, 400);
    });

    let filled;
    await t.test('a fill runs as a job and saves a new asset beside the original', async () => {
        const started = await post(source._id, owner.headers);
        assert.equal(started.status, 202);
        const { data } = await started.json();
        const job = await jobs.waitFor(data.jobId, { timeoutMs: 240000 });
        assert.equal(job.status, 'done', JSON.stringify(job.error));
        const polled = await (await fetch(`${base}/jobs/${data.jobId}`, { headers: owner.headers })).json();
        assert.equal(polled.data.status, 'done');

        filled = await Asset.findById(job.result.asset._id).lean();
        files.push(filled.filename, filled.generatedMaskFilename, filled.thumbnailFilename);
        assert.equal(String(filled.filledFrom), String(source._id));
        assert.equal(filled.originalName, 'room (gaps filled).jpg');
        assert.ok(job.result.filledFraction > 0.1, `filled ${job.result.filledFraction}`);
        assert.ok(job.result.stillMissingFraction > 0, 'the poles are too far from the band to invent');
        assert.deepEqual(await fs.readFile(resolveUploadFile(filename)), originalBytes, 'the original is not changed');

        const { data: pixels, info } = await sharp(resolveUploadFile(filled.filename)).raw().toBuffer({ resolveWithObject: true });
        const at = (y) => pixels[(y * info.width + 40) * 3];
        assert.ok(Math.abs(at(170) - 128) < 12, `just above the band is generated: ${at(170)}`);
        assert.ok(Math.abs(at(256) - 170) < 12, `the band is as photographed: ${at(256)}`);
        assert.ok(at(10) < 20, `the far top stays black: ${at(10)}`);

        // Recognition and detection see the generated pixels as not photographed.
        const blanked = await blankGeneratedPixels(resolveUploadFile(filled.filename), pixels, info);
        assert.ok(blanked > 0);
        assert.ok(pixels[(170 * info.width + 40) * 3] === 0);
    });

    await t.test('deleting the filled asset removes its mask too', async () => {
        const removed = await fetch(`${base}/upload/${filled._id}`, { method: 'DELETE', headers: owner.headers });
        assert.equal(removed.status, 200);
        await processPendingFiles();
        await assert.rejects(fs.access(resolveUploadFile(filled.generatedMaskFilename)));
        await assert.rejects(fs.access(resolveUploadFile(filled.filename)));
    });

    await t.test('a panorama with no gaps is refused', async () => {
        const plain = `fill-test-${randomUUID()}.jpg`;
        files.push(plain);
        await sharp({ create: { width: 512, height: 256, channels: 3, background: '#888888' } }).jpeg().toFile(resolveUploadFile(plain));
        const asset = await Asset.create({ projectId: project._id, filename: plain, path: `/uploads/${plain}` });
        const { data } = await (await post(asset._id, owner.headers)).json();
        const job = await jobs.waitFor(data.jobId, { timeoutMs: 60000 });
        assert.equal(job.status, 'failed');
        assert.equal(job.error.status, 422);
    });
});
