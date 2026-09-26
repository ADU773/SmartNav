const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderView, rankScenes, viewYaws, wrapDeg, descriptorFromHidden, VIEW_STEP_DEG } = require('../services/placeRecognition');

/** An equirectangular test image whose red channel encodes the column. */
function longitudeRamp(width, height) {
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 3;
            rgb[i] = Math.round((x / (width - 1)) * 255);
            rgb[i + 1] = 128;
            rgb[i + 2] = 128;
        }
    }
    return rgb;
}

const centrePixel = (pixels, size) => {
    const i = ((size / 2) * size + size / 2) * 3;
    return pixels[i];
};

test('views look where their yaw says, in the viewer\'s convention', () => {
    const width = 720, height = 360, size = 32;
    const rgb = longitudeRamp(width, height);
    // yaw 0 = centre column; +90 = three quarters across; -90 = one quarter.
    for (const [yawDeg, expectedColumnFraction] of [[0, 0.5], [90, 0.75], [-90, 0.25]]) {
        const { pixels, emptyFraction } = renderView(rgb, width, height, { yawDeg, size });
        assert.equal(emptyFraction, 0);
        assert.ok(Math.abs(centrePixel(pixels, size) / 255 - expectedColumnFraction) < 0.02, `yaw ${yawDeg}`);
    }
});

test('a view into the uncovered part of a partial panorama is reported as empty', () => {
    const width = 360, height = 180;
    const rgb = new Uint8Array(width * height * 3); // all black: nothing captured
    assert.equal(renderView(rgb, width, height, { yawDeg: 0, size: 16 }).emptyFraction, 1);
});

test('the index ring covers the full turn once, every step', () => {
    const yaws = viewYaws();
    assert.equal(yaws.length, 360 / VIEW_STEP_DEG);
    assert.equal(yaws[0], -180);
    assert.equal(new Set(yaws).size, yaws.length);
    assert.equal(wrapDeg(190), -170);
    assert.equal(wrapDeg(-180), 180);
});

test('descriptors are unit length with both halves weighted equally', () => {
    const tokens = 5, dim = 4;
    const hidden = new Float32Array(tokens * dim).map((_, i) => (i % 7) + 1);
    const d = descriptorFromHidden(hidden, tokens, dim);
    assert.equal(d.length, 2 * dim);
    const norm = Math.hypot(...d);
    assert.ok(Math.abs(norm - 1) < 1e-6);
    const halfNorm = (from, to) => Math.hypot(...d.slice(from, to));
    assert.ok(Math.abs(halfNorm(0, dim) - halfNorm(dim, 2 * dim)) < 1e-6);
});

const unit = (angles) => { const v = Float32Array.from(angles); const n = Math.hypot(...v); return v.map((x) => x / n); };

test('ranking picks the best scene and refines the heading between views', () => {
    const query = unit([1, 0]);
    // Views either side of the peak score equally, so the refined heading is
    // exactly the centre view's yaw.
    const index = [
        { sceneId: 'lobby', views: [
            { yawDeg: 15, vector: unit([0.9, 0.44]) },
            { yawDeg: 30, vector: unit([1, 0.05]) },
            { yawDeg: 45, vector: unit([0.9, 0.44]) },
        ] },
        { sceneId: 'hall', views: [{ yawDeg: 0, vector: unit([0.2, 1]) }] },
    ];
    const [best, second] = rankScenes(query, index);
    assert.equal(best.sceneId, 'lobby');
    assert.equal(best.yawDeg, 30);
    assert.equal(best.confidence, 'high');
    assert.equal(second.confidence, 'low', 'only the top answer carries confidence');

    // A lopsided peak moves the heading toward the stronger neighbour.
    index[0].views[2].vector = unit([0.97, 0.2]);
    assert.ok(rankScenes(query, index)[0].yawDeg > 30);
});

test('a strong lead over weak scores is still low confidence (unmapped place)', () => {
    // Mirrors real photos taken in a room that was never mapped: the best
    // scene wins clearly, but nothing actually looks alike.
    const query = unit([1, 0, 0]);
    const index = [
        { sceneId: 'a', views: [{ yawDeg: 0, vector: unit([0.48, 0.877, 0]) }] },
        { sceneId: 'b', views: [{ yawDeg: 0, vector: unit([0.2, 0, 0.98]) }] },
    ];
    const [best] = rankScenes(query, index);
    assert.equal(best.sceneId, 'a');
    assert.ok(best.score < 0.5);
    assert.equal(best.confidence, 'low');
});

test('two similar-looking scenes are not reported with high confidence', () => {
    const query = unit([1, 0]);
    const index = [
        { sceneId: 'left-wing', views: [{ yawDeg: 0, vector: unit([1, 0.30]) }] },
        { sceneId: 'right-wing', views: [{ yawDeg: 0, vector: unit([1, 0.32]) }] },
    ];
    const [best] = rankScenes(query, index);
    assert.notEqual(best.confidence, 'high');
});
