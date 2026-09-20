const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');
const Asset = require('../models/Asset');
const Project = require('../models/Project');
const upload = require('../middleware/uploadMiddleware');
const uploadRoutes = require('../routes/uploadRoutes');

// Real frontend Axios service -> HTTP -> Express -> Multer -> disk -> controller.
// Only database I/O is stubbed; records still pass the actual Mongoose schema.
test('upload HTTP contract and failure cleanup', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smartnav-upload-'));
    const records = [];
    let failDatabase = false;
    const projectId = '507f1f77bcf86cd799439011';
    t.mock.method(upload.storage, 'getDestination', (req, file, cb) => cb(null, directory));
    t.mock.method(Project, 'exists', async ({ _id }) => _id === projectId ? { _id } : null);
    t.mock.method(Asset, 'create', async (data) => {
        if (failDatabase) throw new Error('Simulated database failure');
        const asset = new Asset(data);
        await asset.validate();
        records.push(asset);
        return asset;
    });
    t.mock.method(Asset, 'find', async ({ projectId: id }) => records.filter((asset) => String(asset.projectId) === id));
    const requests = [];
    const app = express();
    app.use((req, res, next) => { requests.push({ url: req.url, contentType: req.headers['content-type'] }); next(); });
    app.use(express.json());
    app.post('/json-check', (req, res) => res.json(req.body));
    app.use('/api/upload', uploadRoutes);
    app.use('/uploads', express.static(directory));
    app.use((error, req, res, _next) => res.status(400).json({ success: false, message: error.message }));
    const listener = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const baseURL = `http://127.0.0.1:${listener.address().port}`;
    let vite;
    t.after(async () => {
        await vite?.close();
        await new Promise((resolve, reject) => listener.close((err) => err ? reject(err) : resolve()));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const { createServer } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/node_modules/vite/dist/node/index.js')));
    vite = await createServer({ root: path.resolve(__dirname, '../../frontend'), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' });
    const { default: service } = await vite.ssrLoadModule('/src/services/upload.service.js');
    const { default: client } = await vite.ssrLoadModule('/src/services/api.js');
    const { getImageUrl } = await vite.ssrLoadModule('/src/utils/getImageUrl.js');
    const constants = await vite.ssrLoadModule('/src/constants/api.js');
    client.defaults.baseURL = baseURL;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
    const file = (bytes = png, name = 'Lobby.PNG', type = 'image/png') => new File([bytes], name, { type });
    const post = async (image, id = projectId) => {
        const form = new FormData();
        // Exercise file-first ordering too; other clients need not follow ours.
        if (image) form.append('image', image);
        if (id !== null) form.append('projectId', id);
        return fetch(`${baseURL}/api/upload`, { method: 'POST', body: form });
    };
    const assertFiles = async (count) => {
        // Controller cleanup may finish just after the HTTP response is sent.
        for (let i = 0; i < 50; i++) {
            if ((await fs.readdir(directory)).length === count) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal((await fs.readdir(directory)).length, count);
    };

    await t.test('actual frontend service sends multipart and image bytes remain loadable', async () => {
        const result = await service.uploadImage(file(), projectId);
        assert.equal(result.success, true);
        assert.match(requests.find((req) => req.url === '/api/upload').contentType, /^multipart\/form-data; boundary=.+/);
        assert.match(result.data.filename, /^[0-9a-f-]{36}\.png$/);
        assert.equal(result.data.originalName, 'Lobby.PNG');
        assert.equal(result.data.projectId, projectId);
        assert.equal(result.data.path, `/uploads/${result.data.filename}`);
        assert.deepEqual(await fs.readFile(path.join(directory, result.data.filename)), png);
        const url = getImageUrl(result.data.path);
        assert.equal(url, `${constants.API_BASE_URL}${result.data.path}`);
        assert.equal(getImageUrl(url), url);
        assert.equal(getImageUrl(result.data.path.slice(1)), url);
        const response = await fetch(`${baseURL}${new URL(url).pathname}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^image\/png/);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
        assert.equal((await service.getUploads(projectId)).data[0]._id, result.data._id);
        assert.deepEqual((await client.post('/json-check', { name: 'still JSON' })).data, { name: 'still JSON' });
    });
    await t.test('simultaneous uploads have distinct safe names', async () => {
        const results = await Promise.all([service.uploadImage(file(), projectId), service.uploadImage(file(), projectId)]);
        assert.notEqual(results[0].data.filename, results[1].data.filename);
        await assertFiles(3);
    });
    await t.test('missing, malformed and nonexistent project IDs leave no files', async () => {
        for (const [id, status] of [[null, 400], ['bad-id', 400], ['507f1f77bcf86cd799439012', 404]]) {
            assert.equal((await post(file(), id)).status, status);
            await assertFiles(3);
        }
    });
    await t.test('missing file, spoofed content, mismatched MIME, SVG and EXR are rejected', async () => {
        for (const image of [null, file(Buffer.from('<html>not an image</html>')), file(png, 'photo.jpg', 'image/png'), file(png, 'spoof.jpg', 'image/jpeg'), file(Buffer.alloc(0)), file(Buffer.from('<svg/>'), 'test.svg', 'image/svg+xml'), file(png, 'test.exr', 'application/octet-stream')]) {
            assert.equal((await post(image)).status, 400);
            await assertFiles(3);
        }
    });
    await t.test('binary MIME is accepted only when the signature matches', async () => {
        assert.equal((await post(file(png, 'binary.png', 'application/octet-stream'))).status, 200);
        assert.equal((await post(file(Buffer.from('not a valid image'), 'binary.png', 'application/octet-stream'))).status, 400);
        await assertFiles(4);
    });
    await t.test('database write failure removes the uploaded file', async () => {
        failDatabase = true;
        try { assert.equal((await post(file())).status, 500); }
        finally { failDatabase = false; }
        await assertFiles(4);
        assert.equal(records.length, 4);
    });
    await t.test('Multer size and unexpected-file failures clean up partial files', async () => {
        const originalLimit = upload.limits.fileSize;
        upload.limits.fileSize = 16;
        try { assert.equal((await post(file())).status, 400); }
        finally { upload.limits.fileSize = originalLimit; }
        const form = new FormData();
        form.append('projectId', projectId);
        form.append('image', file());
        form.append('other', file());
        assert.equal((await fetch(`${baseURL}/api/upload`, { method: 'POST', body: form })).status, 400);
        await assertFiles(4);
    });
});
