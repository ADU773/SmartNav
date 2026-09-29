/**
 * Text-to-scene search: "which scene shows a whiteboard, and where?"
 *
 * Each scene's panorama is rendered as a ring of ordinary camera views, one
 * every SEARCH_STEP_DEG of yaw, and each view is embedded with CLIP's image
 * encoder. A query is embedded with CLIP's text encoder, and a scene scores as
 * its best-matching view; that view's yaw is where the viewer should turn.
 *
 * This module is pure: view layout and ranking take vectors and return
 * numbers. Model loading and I/O live in ml/clipModel.js and searchIndex.js.
 */

// Wider than a phone photo (see placeRecognition.js): CLIP was trained on
// photographs framed around their subject, and a 75° view keeps a whole
// desk, doorway or poster in frame. Views 30° apart overlap by 45°, so any
// object up to 45° wide is entirely inside at least one view.
const SEARCH_FOV_DEG = 75;
const SEARCH_STEP_DEG = 30;

// Views are sampled at about one panorama pixel per view pixel: a 224-pixel,
// 75° view needs a panorama about 224 * 360 / 75 = 1075 pixels wide. Decoding
// at this size (with sharp's antialiased resize) instead of full resolution
// avoids aliasing and uses 2 MB rather than 25 MB per panorama.
const SEARCH_PANORAMA_WIDTH = 1152;

// CLIP's learned temperature: its logit scale trained to the cap of 100.
// Softmax of 100 x cosine over the candidates is exactly how CLIP turns
// similarities into probabilities for zero-shot retrieval.
const LOGIT_SCALE = 100;

/** The yaws a panorama is indexed at: -180 .. 150 in SEARCH_STEP_DEG steps. */
function searchYaws(step = SEARCH_STEP_DEG) {
    const yaws = [];
    for (let yaw = -180; yaw < 180; yaw += step) yaws.push(yaw);
    return yaws;
}

function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
    return sum;
}

function wrapDeg(angle) {
    let wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
    if (wrapped === -180) wrapped = 180;
    return wrapped;
}

function round(value, places) {
    const f = 10 ** places;
    return Math.round(value * f) / f;
}

/**
 * Refines the best view's yaw by fitting a parabola through its score and its
 * two neighbours' (exact when the scores lie on a parabola). Without both
 * neighbours, or without a peak, the grid yaw is kept.
 * @param {{ yawDeg: number, score: number }[]} scored
 * @param {number} best - index into `scored`
 */
function refineYaw(scored, best, step = SEARCH_STEP_DEG) {
    const at = (yaw) => scored.find((view) => Math.abs(wrapDeg(view.yawDeg - yaw)) < 1e-6);
    const centre = scored[best];
    const left = at(centre.yawDeg - step);
    const right = at(centre.yawDeg + step);
    if (!left || !right) return wrapDeg(centre.yawDeg);
    const denominator = left.score - 2 * centre.score + right.score;
    if (denominator >= 0) return wrapDeg(centre.yawDeg);
    const offset = 0.5 * (left.score - right.score) / denominator; // in steps
    return wrapDeg(centre.yawDeg + Math.max(-0.5, Math.min(0.5, offset)) * step);
}

/**
 * Ranks scenes for one query vector.
 *
 * `probability` is CLIP's softmax over the scenes' best views: how sure the
 * model is that this scene, rather than another in the same tour, is the one
 * described. It is relative; a query matching nothing still sums to 1.
 *
 * @param {Float32Array} query - unit length
 * @param {{ sceneId: string, views: { yawDeg: number, vector: Float32Array }[] }[]} index
 * @returns {{ sceneId: string, score: number, probability: number, yawDeg: number }[]} best first
 */
function rankScenesByText(query, index) {
    const ranked = [];
    for (const entry of index) {
        if (!entry.views.length) continue;
        const scored = entry.views.map((view) => ({ yawDeg: view.yawDeg, score: dot(query, view.vector) }));
        let best = 0;
        for (let i = 1; i < scored.length; i += 1) if (scored[i].score > scored[best].score) best = i;
        ranked.push({ sceneId: entry.sceneId, score: scored[best].score, yawDeg: refineYaw(scored, best) });
    }
    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length) return [];

    // Subtracting the top score keeps exp() in range for any scale.
    const weights = ranked.map((entry) => Math.exp(LOGIT_SCALE * (entry.score - ranked[0].score)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return ranked.map((entry, i) => ({
        sceneId: entry.sceneId,
        score: round(entry.score, 4),
        probability: round(weights[i] / total, 3),
        yawDeg: round(entry.yawDeg, 1),
    }));
}

module.exports = {
    SEARCH_FOV_DEG,
    SEARCH_STEP_DEG,
    SEARCH_PANORAMA_WIDTH,
    LOGIT_SCALE,
    searchYaws,
    refineYaw,
    rankScenesByText,
    wrapDeg,
};
