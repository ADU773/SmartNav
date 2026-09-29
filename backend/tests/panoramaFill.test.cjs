const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findGaps, distanceFromContent, fillPanorama, fillViews, worldToView, viewToWorld, viewRotation } = require('../services/panoramaFill');

/** A grey panorama with black above and below a photographed band. */
function bandPanorama(width, height, fromRow, toRow) {
    const rgb = new Uint8Array(width * height * 3);
    for (let y = fromRow; y < toRow; y += 1) rgb.fill(150, y * width * 3, (y + 1) * width * 3);
    return rgb;
}

test('gaps are large black regions; small dark patches are real content', () => {
    const width = 200, height = 100;
    const rgb = bandPanorama(width, height, 30, 70);
    // A dark 3x3 patch inside the band: a black jacket, not a gap.
    for (let y = 50; y < 53; y += 1) for (let x = 100; x < 103; x += 1) rgb.fill(5, (y * width + x) * 3, (y * width + x) * 3 + 3);
    const gaps = findGaps(rgb, width, height);
    assert.equal(gaps[10 * width + 50], 1, 'black above the band');
    assert.equal(gaps[90 * width + 50], 1, 'black below the band');
    assert.equal(gaps[51 * width + 101], 0, 'the dark patch is kept');
    assert.equal(gaps[40 * width + 50], 0, 'photographed pixels are kept');
});

test('distance into a gap is measured in degrees from photographed pixels', () => {
    const width = 360, height = 180; // one pixel per degree
    const gaps = new Uint8Array(width * height).fill(1);
    for (let x = 0; x < width; x += 1) gaps[90 * width + x] = 0; // photographed horizon line
    const dist = distanceFromContent(gaps, width, height);
    assert.ok(Math.abs(dist[60 * width + 10] - 30) < 1.5, `30 rows above: ${dist[60 * width + 10]}`);
    assert.equal(dist[90 * width + 10], 0);
});

test('view projection round-trips', () => {
    for (const view of fillViews()) {
        const rotation = viewRotation(view);
        const point = worldToView(viewToWorld(0.3, -0.2, rotation), rotation);
        assert.ok(Math.abs(point[0] - 0.3) < 1e-9 && Math.abs(point[1] + 0.2) < 1e-9, JSON.stringify(view));
    }
});

test('fills gaps near the photographed band, leaves distant ones black, keeps photographed pixels', async () => {
    const width = 512, height = 256;
    const rgb = bandPanorama(width, height, 96, 160); // covers latitudes about -22..+22
    const original = Uint8Array.from(rgb);
    const calls = [];
    const inpaint = async (view, mask) => {
        calls.push(mask.reduce((a, b) => a + b, 0));
        const out = Uint8Array.from(view);
        for (let i = 0; i < mask.length; i += 1) if (mask[i]) out.fill(90, i * 3, i * 3 + 3);
        return out;
    };
    const result = await fillPanorama(rgb, width, height, { inpaint, size: 64, maxFillDeg: 25 });
    assert.ok(calls.length > 0 && calls.every((n) => n > 0), 'the model only sees views with something missing');
    const at = (latDeg) => Math.round((0.5 - latDeg / 180) * height) * width + 17;
    assert.equal(result.rgb[at(35) * 3], 90, '13° above the band: filled');
    assert.equal(result.rgb[at(-35) * 3], 90, '13° below the band: filled');
    assert.equal(result.rgb[at(80) * 3], 0, 'far above: still black');
    assert.equal(result.generated[at(80)], 0);
    assert.equal(result.generated[at(35)], 1);
    for (let y = 100; y < 156; y += 1) {
        const i = y * width + 300;
        assert.equal(result.rgb[i * 3], original[i * 3], 'photographed pixels are untouched');
    }
    assert.ok(result.filledFraction > 0.1 && result.filledFraction < result.gapFraction);
});

test('a panorama without gaps is left alone', async () => {
    const rgb = new Uint8Array(128 * 64 * 3).fill(120);
    const result = await fillPanorama(rgb, 128, 64, { inpaint: async () => { throw new Error('not needed'); }, size: 64 });
    assert.equal(result.gapFraction, 0);
    assert.equal(result.viewsFilled, 0);
});
