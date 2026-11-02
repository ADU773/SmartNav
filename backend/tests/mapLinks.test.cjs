const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAngle, mapBearing, mapDistanceMeters, hotspotYaw, estimateOffset } = require('../services/mapLinks');

const deg = (rad) => (rad * 180) / Math.PI;
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);

test('map bearings are clockwise from the top of the floor plan', () => {
    const centre = { x: 50, y: 50 };
    close(deg(mapBearing(centre, { x: 50, y: 10 })), 0);
    close(deg(mapBearing(centre, { x: 90, y: 50 })), 90);
    close(deg(mapBearing(centre, { x: 50, y: 90 })), 180);
    close(deg(mapBearing(centre, { x: 10, y: 50 })), -90);
});

test('a wide floor plan keeps angles true', () => {
    // 2:1 plan (height/width 0.5): 10% across equals 20% down in real length.
    close(deg(mapBearing({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)), 135);
});

test('distances use the floor plan scale and are absent without one', () => {
    assert.equal(mapDistanceMeters({ x: 0, y: 0 }, { x: 30, y: 40 }, 1, 50), 25);
    assert.equal(mapDistanceMeters({ x: 0, y: 0 }, { x: 0, y: 40 }, 0.5, 100), 20);
    assert.equal(mapDistanceMeters({ x: 0, y: 0 }, { x: 30, y: 40 }, 1, undefined), null);
});

test('hotspot yaw adds the scene offset and wraps at ±180°', () => {
    close(deg(hotspotYaw(Math.PI / 2, Math.PI / 4)), 135);
    close(deg(hotspotYaw((170 * Math.PI) / 180, (30 * Math.PI) / 180)), -160);
    close(normalizeAngle(3 * Math.PI), Math.PI);
});

test('a scene offset is learned from hotspots placed by hand', () => {
    const offset = (35 * Math.PI) / 180;
    const here = { x: 50, y: 50 };
    const positions = new Map([['east', { x: 80, y: 50 }], ['north', { x: 50, y: 20 }], ['unplaced', null]]);
    positions.delete('unplaced');
    const scene = {
        mapPosition: here,
        hotspots: [
            { targetScene: 'east', yaw: hotspotYaw(Math.PI / 2, offset) },
            { targetScene: 'north', yaw: hotspotYaw(0, offset) },
            { targetScene: 'unplaced', yaw: 2 },
        ],
    };
    close(estimateOffset(scene, positions), offset, 1e-9);
    assert.equal(estimateOffset({ mapPosition: here, hotspots: [] }, positions), null);
    assert.equal(estimateOffset({ hotspots: scene.hotspots }, positions), null);
});
