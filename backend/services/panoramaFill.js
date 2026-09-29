/**
 * Fills the uncovered (black) parts of a stitched 360° panorama.
 *
 * A panorama stitched from phone photos rarely covers the whole sphere: the
 * ceiling, the floor below the phone, and gaps between frames stay black. An
 * inpainting model trained on ordinary photos cannot work on an
 * equirectangular image directly (everything near the top and bottom is
 * stretched), so the gaps are filled through ordinary camera views instead:
 *
 * 1. Find the gaps: large connected regions of near-black pixels. Small dark
 *    patches (a black jacket, a switched-off screen) are left alone.
 * 2. Walk a fixed set of views, horizon first, then rings looking up and
 *    down, then straight up and straight down. For each view that sees
 *    enough of a gap, render it with a mask of the missing pixels, let the
 *    model fill it, and write the result back into the gap pixels near the
 *    view's centre. Later views therefore see earlier fills as context, so
 *    the fills join up.
 * 3. The caller pastes the filled gap pixels into the full-resolution
 *    panorama; everything that was photographed stays untouched.
 *
 * Only gaps within MAX_FILL_DEG of photographed content are filled. Further
 * out the model has nothing to continue and produces grey smudge (measured
 * on a capture that covered a fifth of the sphere), so those parts stay black
 * and the result reports how much is still missing.
 *
 * This module is pure apart from the `inpaint` function it is given.
 */

const DEG = Math.PI / 180;

// Near-black test: a gap must contain some truly black pixels (seed) and may
// grow over dark JPEG fringe around them (grow).
const EMPTY_SEED_SUM = 12;
const EMPTY_GROW_SUM = 36;
// Smaller dark regions are real content, not a gap.
const MIN_GAP_FRACTION = 0.002;
// Covers the dark fringe the stitcher's feathering leaves along a gap.
const GAP_GROW_PX = 3;
// Views: horizon ring, rings 55° up and down, then the poles. 90° wide, like
// the detection views, so each view is an ordinary-looking photo.
const VIEW_FOV_DEG = 90;
// A view is used when at least this share of it is still missing.
const MIN_VIEW_MISSING = 0.002;
// How far into a gap, in degrees of arc from photographed pixels, to fill.
const MAX_FILL_DEG = 25;
// First pass: write back only near a view's centre, where it is least
// distorted. A second pass fills whatever is left from anywhere in a view.
const CENTRE_REGION = 0.8;

function fillViews() {
    const views = [];
    for (let yaw = -180; yaw < 180; yaw += 45) views.push({ yawDeg: yaw, pitchDeg: 0 });
    for (let yaw = -180; yaw < 180; yaw += 60) views.push({ yawDeg: yaw + 30, pitchDeg: 55 });
    for (let yaw = -180; yaw < 180; yaw += 60) views.push({ yawDeg: yaw + 30, pitchDeg: -55 });
    views.push({ yawDeg: 0, pitchDeg: 90 }, { yawDeg: 0, pitchDeg: -90 });
    return views.map((view) => ({ ...view, fovDeg: VIEW_FOV_DEG }));
}

/**
 * The gaps: 1 for every pixel that must be generated.
 * @param {Uint8Array} rgb - width x height x 3
 */
function findGaps(rgb, width, height) {
    const total = width * height;
    const dark = new Uint8Array(total); // 0 = not dark, 1 = fringe, 2 = black
    for (let i = 0; i < total; i += 1) {
        const sum = rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2];
        if (sum <= EMPTY_SEED_SUM) dark[i] = 2;
        else if (sum <= EMPTY_GROW_SUM) dark[i] = 1;
    }

    // Connected dark regions (4-neighbour, wrapping across the ±180° seam)
    // that contain black pixels and are large enough to be a gap.
    const gaps = new Uint8Array(total);
    const seen = new Uint8Array(total);
    const stack = new Int32Array(total);
    const minSize = Math.max(1, Math.round(MIN_GAP_FRACTION * total));
    const region = [];
    for (let start = 0; start < total; start += 1) {
        if (!dark[start] || seen[start]) continue;
        region.length = 0;
        let hasSeed = false;
        let top = 0;
        stack[top++] = start;
        seen[start] = 1;
        while (top) {
            const i = stack[--top];
            region.push(i);
            if (dark[i] === 2) hasSeed = true;
            const x = i % width;
            const y = (i - x) / width;
            const neighbours = [
                y * width + ((x + 1) % width),
                y * width + ((x + width - 1) % width),
                y > 0 ? i - width : -1,
                y < height - 1 ? i + width : -1,
            ];
            for (const n of neighbours) {
                if (n >= 0 && dark[n] && !seen[n]) { seen[n] = 1; stack[top++] = n; }
            }
        }
        if (hasSeed && region.length >= minSize) for (const i of region) gaps[i] = 1;
    }
    return grow(gaps, width, height, GAP_GROW_PX);
}

/** Grows a mask by `radius` pixels (square), wrapping horizontally. */
function grow(mask, width, height, radius) {
    if (!radius) return mask;
    const rows = new Uint8Array(mask.length);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let on = 0;
            for (let d = -radius; d <= radius && !on; d += 1) on = mask[y * width + ((x + d + width) % width)];
            rows[y * width + x] = on;
        }
    }
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let on = 0;
            for (let d = -radius; d <= radius && !on; d += 1) {
                const yy = y + d;
                if (yy >= 0 && yy < height) on = rows[yy * width + x];
            }
            out[y * width + x] = on;
        }
    }
    return out;
}

/**
 * Approximate angular distance (degrees) from every pixel to the nearest
 * pixel not in `gaps`: a chamfer distance transform on the equirectangular
 * grid, with horizontal steps shrunk by cos(latitude) and the ±180° seam
 * wrapped. Good to a few degrees, which is all the fill limit needs.
 */
function distanceFromContent(gaps, width, height) {
    const INF = 1e9;
    const dist = new Float32Array(gaps.length);
    for (let i = 0; i < gaps.length; i += 1) dist[i] = gaps[i] ? INF : 0;
    const dy = 180 / height;
    const dxRow = new Float32Array(height);
    for (let y = 0; y < height; y += 1) dxRow[y] = (360 / width) * Math.max(0.02, Math.cos((0.5 - (y + 0.5) / height) * Math.PI));
    for (let round = 0; round < 2; round += 1) {
        for (let y = 0; y < height; y += 1) {
            const dx = dxRow[y], dd = Math.hypot(dx, dy);
            for (let x = 0; x < width; x += 1) {
                const i = y * width + x;
                let d = dist[i];
                d = Math.min(d, dist[y * width + ((x + width - 1) % width)] + dx);
                if (y > 0) {
                    d = Math.min(d, dist[i - width] + dy);
                    d = Math.min(d, dist[(y - 1) * width + ((x + width - 1) % width)] + dd);
                    d = Math.min(d, dist[(y - 1) * width + ((x + 1) % width)] + dd);
                }
                dist[i] = d;
            }
        }
        for (let y = height - 1; y >= 0; y -= 1) {
            const dx = dxRow[y], dd = Math.hypot(dx, dy);
            for (let x = width - 1; x >= 0; x -= 1) {
                const i = y * width + x;
                let d = dist[i];
                d = Math.min(d, dist[y * width + ((x + 1) % width)] + dx);
                if (y < height - 1) {
                    d = Math.min(d, dist[i + width] + dy);
                    d = Math.min(d, dist[(y + 1) * width + ((x + width - 1) % width)] + dd);
                    d = Math.min(d, dist[(y + 1) * width + ((x + 1) % width)] + dd);
                }
                dist[i] = d;
            }
        }
    }
    return dist;
}

/** Camera basis for a view, in the convention of placeRecognition.renderView (pitch positive up). */
function viewRotation({ yawDeg, pitchDeg }) {
    const cy = Math.cos(yawDeg * DEG), sy = Math.sin(yawDeg * DEG);
    const cp = Math.cos(pitchDeg * DEG), sp = Math.sin(pitchDeg * DEG);
    return { cy, sy, cp, sp };
}

/** View-plane point (x, y, in units of the half-width) to a unit direction. */
function viewToWorld(x, y, { cy, sy, cp, sp }) {
    const len = Math.hypot(x, y, 1);
    const dx0 = x / len, dy0 = y / len, dz0 = 1 / len;
    const dy = dy0 * cp + dz0 * sp;
    const dz1 = -dy0 * sp + dz0 * cp;
    return [dx0 * cy + dz1 * sy, dy, -dx0 * sy + dz1 * cy];
}

/** Unit direction to a view-plane point, or null when it is behind the camera. */
function worldToView([dx, dy, dz], { cy, sy, cp, sp }) {
    const dx0 = dx * cy - dz * sy;
    const dz1 = dx * sy + dz * cy;
    const dy0 = dy * cp - dz1 * sp;
    const dz0 = dy * sp + dz1 * cp;
    if (dz0 <= 1e-6) return null;
    return [dx0 / dz0, dy0 / dz0];
}

/** Equirectangular pixel centre to a unit direction. */
function pixelToWorld(px, py, width, height) {
    const lon = ((px + 0.5) / width - 0.5) * 2 * Math.PI;
    const lat = (0.5 - (py + 0.5) / height) * Math.PI;
    return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

function sampleEquirect(rgb, width, height, direction, out) {
    const lon = Math.atan2(direction[0], direction[2]);
    const lat = Math.asin(Math.max(-1, Math.min(1, direction[1])));
    const fx = (lon / (2 * Math.PI) + 0.5) * width - 0.5;
    const fy = (0.5 - lat / Math.PI) * height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = ((x0 % width) + width) % width;
    const xb = (xa + 1) % width;
    const ya = Math.max(0, Math.min(height - 1, y0));
    const yb = Math.max(0, Math.min(height - 1, y0 + 1));
    for (let c = 0; c < 3; c += 1) {
        const top = rgb[(ya * width + xa) * 3 + c] * (1 - tx) + rgb[(ya * width + xb) * 3 + c] * tx;
        const bottom = rgb[(yb * width + xa) * 3 + c] * (1 - tx) + rgb[(yb * width + xb) * 3 + c] * tx;
        out[c] = top * (1 - ty) + bottom * ty;
    }
    return { x: ((Math.round(fx) % width) + width) % width, y: Math.max(0, Math.min(height - 1, Math.round(fy))) };
}

/**
 * Renders one view of the panorama and the mask of what is still missing.
 * @returns {{ rgb: Uint8Array, mask: Uint8Array, missing: number }}
 */
function renderViewWithMask(rgb, missing, width, height, view, size) {
    const rotation = viewRotation(view);
    const half = Math.tan((view.fovDeg * DEG) / 2);
    const out = new Uint8Array(size * size * 3);
    const mask = new Uint8Array(size * size);
    const sample = [0, 0, 0];
    let count = 0;
    for (let v = 0; v < size; v += 1) {
        const y = -(((v + 0.5) / size) * 2 - 1) * half;
        for (let u = 0; u < size; u += 1) {
            const x = (((u + 0.5) / size) * 2 - 1) * half;
            const nearest = sampleEquirect(rgb, width, height, viewToWorld(x, y, rotation), sample);
            const o = v * size + u;
            out[o * 3] = sample[0]; out[o * 3 + 1] = sample[1]; out[o * 3 + 2] = sample[2];
            if (missing[nearest.y * width + nearest.x]) { mask[o] = 1; count += 1; }
        }
    }
    // Bilinear sampling bleeds black one pixel past the gap; cover that too.
    return { rgb: out, mask: grow(mask, size, size, 2), missing: count / (size * size) };
}

/**
 * Fills the gaps of an equirectangular panorama.
 *
 * @param {Uint8Array} rgb - working-resolution panorama, width x height x 3 (changed in place)
 * @param {number} width
 * @param {number} height
 * @param {{ inpaint: (rgb: Uint8Array, mask: Uint8Array) => Promise<Uint8Array>, size: number,
 *   progress?: (done: number, total: number) => void }} options - `inpaint` fills one size x size view
 * @returns {Promise<{ rgb: Uint8Array, generated: Uint8Array, gapFraction: number, filledFraction: number,
 *   viewsFilled: number }>} `generated` marks every pixel the model made; `gapFraction` is how much was
 *   black before, `filledFraction` how much of the image is now generated
 */
async function fillPanorama(rgb, width, height, { inpaint, size, maxFillDeg = MAX_FILL_DEG, progress = () => {} }) {
    const gaps = findGaps(rgb, width, height);
    const distance = distanceFromContent(gaps, width, height);
    const missing = new Uint8Array(gaps.length);
    let remaining = [];
    let gapCount = 0;
    for (let i = 0; i < gaps.length; i += 1) {
        if (!gaps[i]) continue;
        gapCount += 1;
        if (distance[i] <= maxFillDeg) { missing[i] = 1; remaining.push(i); }
    }
    const generated = Uint8Array.from(missing);
    const gapFraction = gapCount / gaps.length;
    const filledFraction = remaining.length / gaps.length;
    if (!remaining.length) return { rgb, generated, gapFraction, filledFraction: 0, viewsFilled: 0 };

    const views = fillViews();
    const passes = [CENTRE_REGION, 1];
    const steps = views.length * passes.length;
    let step = 0;
    let viewsFilled = 0;
    const sample = [0, 0, 0];
    for (const region of passes) {
        for (const view of views) {
            step += 1;
            progress(step, steps);
            if (!remaining.length) continue;
            const rotation = viewRotation(view);
            const half = Math.tan((view.fovDeg * DEG) / 2);
            const limit = half * region;
            // Which missing pixels this view would fill.
            const targets = [];
            for (const i of remaining) {
                const px = i % width;
                const point = worldToView(pixelToWorld(px, (i - px) / width, width, height), rotation);
                if (point && Math.abs(point[0]) <= limit && Math.abs(point[1]) <= limit) targets.push([i, point]);
            }
            if (targets.length < MIN_VIEW_MISSING * size * size) continue;

            // Gaps beyond the fill limit stay black, and the model treats them
            // as missing too, so it never copies black into the fill.
            const rendered = renderViewWithMask(rgb, gaps, width, height, view, size);
            const filled = await inpaint(rendered.rgb, rendered.mask);
            viewsFilled += 1;
            for (const [i, [x, y]] of targets) {
                // View-plane point back to a (fractional) pixel of the filled view.
                const u = ((x / half + 1) / 2) * size - 0.5;
                const v = ((1 - y / half) / 2) * size - 0.5;
                const u0 = Math.max(0, Math.min(size - 2, Math.floor(u)));
                const v0 = Math.max(0, Math.min(size - 2, Math.floor(v)));
                const tu = Math.max(0, Math.min(1, u - u0)), tv = Math.max(0, Math.min(1, v - v0));
                for (let c = 0; c < 3; c += 1) {
                    const a = filled[(v0 * size + u0) * 3 + c], b = filled[(v0 * size + u0 + 1) * 3 + c];
                    const d = filled[((v0 + 1) * size + u0) * 3 + c], e = filled[((v0 + 1) * size + u0 + 1) * 3 + c];
                    sample[c] = (a * (1 - tu) + b * tu) * (1 - tv) + (d * (1 - tu) + e * tu) * tv;
                }
                rgb[i * 3] = sample[0]; rgb[i * 3 + 1] = sample[1]; rgb[i * 3 + 2] = sample[2];
                missing[i] = 0;
                gaps[i] = 0; // now context for the views that follow
            }
            remaining = remaining.filter((i) => missing[i]);
        }
    }
    return { rgb, generated, gapFraction, filledFraction, viewsFilled };
}

module.exports = {
    findGaps,
    distanceFromContent,
    fillPanorama,
    MAX_FILL_DEG,
    fillViews,
    worldToView,
    viewToWorld,
    viewRotation,
    pixelToWorld,
    MIN_GAP_FRACTION,
};
