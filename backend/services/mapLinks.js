/**
 * Turns two scene pins on the floor plan into the hotspots between them.
 *
 * Map positions are percentages of the floor-plan image (x across, y down).
 * A scene's `mapYawOffset` is the panorama yaw (radians, Marzipano: right is
 * positive) that faces the top of the floor plan. A hotspot towards another
 * scene therefore sits at that offset plus the map bearing to the other pin,
 * measured clockwise from the top of the map.
 */

const TWO_PI = 2 * Math.PI;
/** Default hotspot height: a little below eye level, where doorways usually are. */
const DEFAULT_PITCH = 0.12;

/** Wraps an angle into -π..π. */
function normalizeAngle(angle) {
    let a = angle % TWO_PI;
    if (a > Math.PI) a -= TWO_PI;
    if (a <= -Math.PI) a += TWO_PI;
    return a;
}

/**
 * Offset from `from` to `to` in units of floor-plan width percent, so x and y
 * are comparable even when the floor plan is not square.
 * @param {number} aspect - floor-plan height / width
 */
function mapDelta(from, to, aspect = 1) {
    return { dx: to.x - from.x, dy: (to.y - from.y) * aspect };
}

/** Bearing (radians, clockwise from the top of the map) from one pin to another. */
function mapBearing(from, to, aspect = 1) {
    const { dx, dy } = mapDelta(from, to, aspect);
    return Math.atan2(dx, -dy);
}

/**
 * Straight-line distance in metres, or null when the floor plan has no scale.
 * @param {number|null|undefined} widthMeters - real width of the floor plan
 */
function mapDistanceMeters(from, to, aspect, widthMeters) {
    if (!(widthMeters > 0)) return null;
    const { dx, dy } = mapDelta(from, to, aspect);
    return Math.round((Math.hypot(dx, dy) / 100) * widthMeters * 10) / 10;
}

/** Panorama yaw of a hotspot pointing along `bearing` in a scene with `offset`. */
function hotspotYaw(bearing, offset) {
    return normalizeAngle(bearing + offset);
}

/**
 * Estimates a scene's offset from hotspots already placed by hand towards
 * scenes that are on the map: each gives yaw - bearing; their circular mean is
 * the offset. Returns null when there is nothing to learn from.
 * @param {{ mapPosition, hotspots }} scene
 * @param {Map<string, {x:number,y:number}>} positions - placed scenes by id
 */
function estimateOffset(scene, positions, aspect = 1) {
    if (!scene.mapPosition) return null;
    let sin = 0;
    let cos = 0;
    let count = 0;
    for (const spot of scene.hotspots || []) {
        const target = positions.get(String(spot.targetScene));
        if (!target || !Number.isFinite(spot.yaw)) continue;
        const angle = spot.yaw - mapBearing(scene.mapPosition, target, aspect);
        sin += Math.sin(angle);
        cos += Math.cos(angle);
        count += 1;
    }
    return count ? normalizeAngle(Math.atan2(sin, cos)) : null;
}

module.exports = { DEFAULT_PITCH, normalizeAngle, mapBearing, mapDistanceMeters, hotspotYaw, estimateOffset };
