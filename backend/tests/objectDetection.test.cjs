const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    COCO_CLASSES, toModelInput, decodeOutput, nonMaxSuppression,
    viewPointToDirection, detectionsFromView, mergeDetections, summarize, detectionViews,
} = require('../services/objectDetection');

const PER_ANCHOR = 5 + COCO_CLASSES.length;

/** Raw YOLOX output for a size x size input with chosen anchors set. */
function rawOutput(size, set = []) {
    const anchors = [8, 16, 32].reduce((sum, s) => sum + (size / s) ** 2, 0);
    const out = new Float32Array(anchors * PER_ANCHOR);
    for (const { anchor, dx = 0, dy = 0, logW = 0, logH = 0, objectness, classIndex, classScore } of set) {
        const o = anchor * PER_ANCHOR;
        out[o] = dx; out[o + 1] = dy; out[o + 2] = logW; out[o + 3] = logH;
        out[o + 4] = objectness;
        out[o + 5 + classIndex] = classScore;
    }
    return out;
}

test('input is planar BGR in 0..255, as the YOLOX export expects', () => {
    const t = toModelInput(Uint8Array.from([10, 20, 30, 40, 50, 60]), 1 + 0); // 1x1 uses first pixel only
    assert.deepEqual(Array.from(t), [30, 20, 10]);
});

test('grid outputs decode to boxes in input pixels (stride 8, 16 and 32 blocks)', () => {
    const size = 64; // 8x8 + 4x4 + 2x2 anchors
    const laptop = COCO_CLASSES.indexOf('laptop');
    const person = COCO_CLASSES.indexOf('person');
    const out = rawOutput(size, [
        // stride 8, cell (gx=2, gy=3): centre (2.5*8, 3.5*8), size exp(ln 2)*8 = 16
        { anchor: 3 * 8 + 2, dx: 0.5, dy: 0.5, logW: Math.log(2), logH: Math.log(2), objectness: 0.9, classIndex: laptop, classScore: 0.8 },
        // stride 32 block starts after 64 + 16 anchors; cell (1, 0)
        { anchor: 64 + 16 + 1, objectness: 0.95, classIndex: person, classScore: 0.9 },
        // below threshold: objectness x class = 0.3
        { anchor: 5, objectness: 0.6, classIndex: laptop, classScore: 0.5 },
    ]);
    const boxes = decodeOutput(out, size);
    assert.equal(boxes.length, 2);
    const box = boxes.find((b) => b.classIndex === laptop);
    assert.deepEqual([box.x1, box.y1, box.x2, box.y2].map((v) => Math.round(v * 1000) / 1000), [12, 20, 28, 36]);
    assert.ok(Math.abs(box.score - 0.72) < 1e-6);
    const big = boxes.find((b) => b.classIndex === person);
    assert.deepEqual([(big.x1 + big.x2) / 2, (big.y1 + big.y2) / 2], [32, 0]);
});

test('an output of the wrong shape is rejected rather than misread', () => {
    assert.throws(() => decodeOutput(new Float32Array(PER_ANCHOR * 10), 64), /anchors/);
});

test('non-maximum suppression keeps the stronger of two overlapping boxes', () => {
    const kept = nonMaxSuppression([
        { x1: 0, y1: 0, x2: 10, y2: 10, score: 0.6, classIndex: 0 },
        { x1: 1, y1: 1, x2: 11, y2: 11, score: 0.9, classIndex: 0 },
        { x1: 50, y1: 50, x2: 60, y2: 60, score: 0.5, classIndex: 0 },
    ]);
    assert.deepEqual(kept.map((b) => b.score), [0.9, 0.5]);
});

test('a point in a view maps to the direction the viewer uses', () => {
    const view = { yawDeg: 45, pitchDeg: 0, fovDeg: 90 };
    const round = (d) => ({ yawDeg: Math.round(d.yawDeg * 10) / 10, pitchDeg: Math.round(d.pitchDeg * 10) / 10 });
    assert.deepEqual(round(viewPointToDirection(320, 320, 640, view)), { yawDeg: 45, pitchDeg: 0 });
    // The right edge of a 90° view is 45° further right.
    assert.deepEqual(round(viewPointToDirection(640, 320, 640, view)), { yawDeg: 90, pitchDeg: 0 });
    // Below the centre is positive pitch: the viewer's pitch points DOWN.
    assert.ok(viewPointToDirection(320, 640, 640, view).pitchDeg > 40);
});

/** Pixel column of a yaw offset (degrees) from the centre of a 90°, 640px view. */
const column = (offsetDeg) => (Math.tan((offsetDeg * Math.PI) / 180) + 1) * 320;
const viewAt = (yawDeg) => ({ yawDeg, pitchDeg: 0, fovDeg: 90 });
const box = (label, fromDeg, toDeg, score = 0.8, y1 = 300, y2 = 340) => ({
    x1: Math.max(0, column(fromDeg)), x2: Math.min(640, column(toDeg)), y1, y2, score, classIndex: COCO_CLASSES.indexOf(label),
});
const sightings = (yawDeg, boxes, id = yawDeg) => detectionsFromView(boxes, 640, viewAt(yawDeg), id);

test('the same object seen from two overlapping views is counted once', () => {
    // A chair spanning yaw 18..27 sits in both the yaw-0 and yaw-45 views.
    const merged = mergeDetections([
        ...sightings(0, [box('chair', 18, 27, 0.7), box('laptop', 18, 27, 0.6)]),
        ...sightings(45, [box('chair', 18 - 45, 27 - 45, 0.9)]),
        ...sightings(90, [box('chair', 120 - 90, 128 - 90, 0.8)]), // a different chair
    ]);
    assert.equal(merged.length, 3, 'one chair twice, another chair, and a laptop in the same spot');
    const chair = merged.find((d) => d.label === 'chair' && d.yawDeg < 90);
    assert.equal(chair.confidence, 0.9, 'the merged object keeps its best confidence');
    assert.ok(Math.abs(chair.yawDeg - 22.5) < 1);
    assert.deepEqual(Object.keys(chair).sort(), ['confidence', 'label', 'pitchDeg', 'yawDeg'], 'internal fields are not returned');
    assert.deepEqual(summarize(merged), [{ label: 'chair', count: 2 }, { label: 'laptop', count: 1 }]);
});

test('neighbouring objects in one view stay separate', () => {
    // Five people side by side, 3° apart: NMS kept them apart, so merging must too.
    const people = [0, 3, 6, 9, 12].map((at) => box('person', at, at + 2.5));
    assert.equal(mergeDetections(sightings(90, people)).length, 5);
});

test('a box nested inside a stronger one in the same view is the same object', () => {
    // Seen on a real panorama: one man reported as his whole body and,
    // separately, as his head and shoulders. NMS keeps both (IoU about 0.4).
    const merged = mergeDetections(sightings(0, [
        box('person', -6, 6, 0.62, 254, 430),
        box('person', -6, 3, 0.35, 255, 346),
    ]));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].confidence, 0.62);
    // A person only partly overlapping another is not nested, and stays.
    assert.equal(mergeDetections(sightings(0, [
        box('person', -6, 6, 0.62, 254, 430),
        box('person', 2, 10, 0.5, 240, 400),
    ])).length, 2);
});

test('small people seen behind a large person close to the camera stay separate', () => {
    // Also seen on a real panorama: the near person's box encloses the heads
    // of three people further back. Inside it, but small and lower down.
    const merged = mergeDetections(sightings(0, [
        box('person', -20, 20, 0.9, 150, 600),
        ...[-12, -2, 8].map((at) => box('person', at, at + 3, 0.6, 330, 370)),
    ]));
    assert.equal(merged.length, 4);
});

test('an object cut off at the edge of one view matches the whole sighting next door', () => {
    // A laptop spanning yaw -20..30: whole in the yaw-0 view, but only its
    // left part (yaw -20..0) is inside the yaw -45 view, whose box is cut off
    // at the right edge and centred about 16° left of the laptop's middle.
    const cut = sightings(-45, [box('laptop', -20 + 45, 30 + 45, 0.95)]);
    assert.ok(cut[0].clipped);
    const merged = mergeDetections([...cut, ...sightings(0, [box('laptop', -20, 30, 0.8)])]);
    assert.equal(merged.length, 1);
    assert.ok(Math.abs(merged[0].yawDeg - 6.1) < 1, 'the direction comes from the view that saw all of it');
    assert.equal(merged[0].confidence, 0.95);
});

test('a large object seen whole from two views merges even though the boxes differ a little', () => {
    const couch = (yawDeg, from, to) => sightings(yawDeg, [box('couch', from - yawDeg, to - yawDeg, 0.8, 200, 460)]);
    assert.equal(mergeDetections([...couch(0, 3, 42), ...couch(45, 5, 44)]).length, 1);
});

test('a small object in front of a large one is not absorbed by it', () => {
    // A large laptop at yaw 0..30 and, from the next view, a small one whose
    // footprint lies over part of it: two laptops.
    const merged = mergeDetections([
        ...sightings(0, [box('laptop', 0, 30, 0.9, 280, 420)]),
        ...sightings(45, [box('laptop', 20 - 45, 26 - 45, 0.5, 300, 330)]),
    ]);
    assert.equal(merged.length, 2);
});

test('cut-off fragments of an object seen whole elsewhere are absorbed, even two from one view', () => {
    // A person at yaw 35..55 is whole in the yaw-45 view. The yaw-0 view cuts
    // them off at its right edge and reports two boxes: the visible part of
    // the body, and separately the head.
    const merged = mergeDetections([
        ...sightings(45, [box('person', 35 - 45, 55 - 45, 0.7, 150, 560)]),
        ...sightings(0, [box('person', 35, 45, 0.8, 150, 560), box('person', 37, 45, 0.45, 150, 260)]),
    ]);
    assert.equal(merged.length, 1);
    assert.ok(Math.abs(merged[0].yawDeg - 45) < 1, 'placed where the whole sighting was');
    assert.equal(merged[0].confidence, 0.8);
});

test('detection views cover the full turn at 45° steps, plus a ring looking down', () => {
    const views = detectionViews();
    assert.deepEqual(views.filter((v) => v.pitchDeg === 0).map((v) => v.yawDeg), [-180, -135, -90, -45, 0, 45, 90, 135]);
    const down = views.filter((v) => v.pitchDeg !== 0);
    assert.deepEqual(down.map((v) => v.yawDeg), [-180, -90, 0, 90]);
    // The downward ring reaches straight down, to the floor below the camera.
    const column = Array.from({ length: 321 }, (_, i) => viewPointToDirection(320, 320 + i, 640, down[0]).pitchDeg);
    assert.ok(Math.max(...column) > 89.5);
});

/*
 * Whole-pipeline checks on simple 3D scenes. A stand-in for a perfect
 * detector reports the box of each block as a detection view sees it, cut
 * off at the view's edges, as YOLOX would. Camera 1.3 m above the floor;
 * x right, y up, z forward (yaw 0).
 */
const DEG = Math.PI / 180;
const CAMERA_HEIGHT = 1.3;

function project([x, y, z], { yawDeg, pitchDeg = 0, fovDeg }) {
    const cy = Math.cos(yawDeg * DEG), sy = Math.sin(yawDeg * DEG);
    const cp = Math.cos(pitchDeg * DEG), sp = Math.sin(pitchDeg * DEG);
    const x0 = x * cy - z * sy, z1 = x * sy + z * cy;
    const y0 = y * cp - z1 * sp, z0 = y * sp + z1 * cp;
    if (z0 <= 1e-9) return null;
    const half = Math.tan((fovDeg * DEG) / 2);
    return [(x0 / z0 / half + 1) * 320, (-y0 / z0 / half + 1) * 320];
}

/** Surface points of an upright block standing at (yaw, distance). */
function block({ label, yawDeg, dist, w, h, d = w, base = 0, along = 0 }) {
    const cx = dist * Math.sin(yawDeg * DEG) + along * Math.cos(yawDeg * DEG);
    const cz = dist * Math.cos(yawDeg * DEG) - along * Math.sin(yawDeg * DEG);
    const points = [];
    const steps = Array.from({ length: 11 }, (_, i) => i / 5 - 1);
    for (const a of steps) for (const b of steps) for (const c of [-1, 1]) {
        for (const [px, py, pz] of [[a, b, c], [a, c, b], [c, a, b]]) {
            points.push([cx + (px * w) / 2, base - CAMERA_HEIGHT + ((py + 1) * h) / 2, cz + (pz * d) / 2]);
        }
    }
    return { label, points };
}

function boxInView(object, view) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, inside = 0;
    const cut = { left: false, right: false, top: false, bottom: false };
    for (const point of object.points) {
        const p = project(point, view);
        if (!p) continue;
        const [u, v] = p;
        if (u < 0) cut.left = true; if (u > 640) cut.right = true;
        if (v < 0) cut.top = true; if (v > 640) cut.bottom = true;
        if (u < 0 || u > 640 || v < 0 || v > 640) continue;
        inside += 1;
        x1 = Math.min(x1, u); x2 = Math.max(x2, u); y1 = Math.min(y1, v); y2 = Math.max(y2, v);
    }
    if (inside < object.points.length / 2 || x2 - x1 < 4 || y2 - y1 < 4) return null;
    // Cut off by an edge: the visible part reaches that edge.
    if (cut.left && x1 < 24) x1 = 0; if (cut.right && x2 > 616) x2 = 640;
    if (cut.top && y1 < 24) y1 = 0; if (cut.bottom && y2 > 616) y2 = 640;
    return { x1, y1, x2, y2, classIndex: COCO_CLASSES.indexOf(object.label) };
}

function scanScene(objects) {
    const found = detectionViews().flatMap((view, index) => {
        const boxes = objects.map((object, i) => {
            const b = boxInView(object, view);
            return b && { ...b, score: 0.5 + 0.04 * ((i * 7 + index * 3) % 10) };
        }).filter(Boolean);
        return detectionsFromView(nonMaxSuppression(boxes), 640, view, index);
    });
    return mergeDetections(found);
}

const chair = { label: 'chair', w: 0.45, h: 0.9 };
const standing = { label: 'person', w: 0.5, d: 0.3, h: 1.7 };
const seated = { label: 'person', w: 0.5, h: 1.25 };

test('an object seen by both the level and the downward views is counted once', () => {
    for (let yawDeg = -180; yawDeg < 180; yawDeg += 10) {
        for (const [shape, dist] of [[chair, 2.5], [chair, 1.2], [{ label: 'bottle', w: 0.08, h: 0.25 }, 1.5], [{ label: 'laptop', w: 0.34, d: 0.24, h: 0.22, base: 0.75 }, 1]]) {
            const found = scanScene([block({ ...shape, yawDeg, dist })]);
            assert.equal(found.length, 1, `${shape.label} at ${dist} m, yaw ${yawDeg}`);
        }
    }
});

test('a person standing close is counted once, though every view cuts them off', () => {
    for (let yawDeg = -180; yawDeg < 180; yawDeg += 15) {
        const found = scanScene([block({ ...standing, yawDeg, dist: 0.8 })]);
        assert.equal(found.length, 1, `yaw ${yawDeg}`);
        // Within the person: at 0.8 m they span about ±17° of yaw.
        assert.ok(Math.abs(((found[0].yawDeg - yawDeg + 540) % 360) - 180) < 10, 'placed on the person');
    }
});

test('an object right under the camera is counted once', () => {
    for (let yawDeg = -180; yawDeg < 180; yawDeg += 30) {
        assert.equal(scanScene([block({ label: 'backpack', w: 0.32, d: 0.2, h: 0.45, yawDeg, dist: 0 })]).length, 1, `yaw ${yawDeg}`);
    }
});

test('a row of chairs and a distant crowd keep every member', () => {
    for (const heading of [0, 40, 95, -150]) {
        const chairs = Array.from({ length: 8 }, (_, i) => block({ ...chair, yawDeg: heading, dist: 2.5, along: (i - 3.5) * 0.55 }));
        assert.equal(scanScene(chairs).length, 8, `chairs facing ${heading}`);
        const crowd = Array.from({ length: 6 }, (_, i) => block({ ...seated, yawDeg: heading, dist: 8, along: (i - 2.5) * 0.5 }));
        assert.equal(scanScene(crowd).length, 6, `crowd facing ${heading}`);
    }
});
