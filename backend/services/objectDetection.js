/**
 * Object detection on 360° panoramas with YOLOX (Ge et al., 2021; Apache-2.0).
 *
 * A detector trained on ordinary photos does badly on an equirectangular
 * panorama: objects near the top and bottom are stretched, and anything on the
 * left/right seam is cut in two. So the panorama is first rendered as a ring
 * of ordinary camera views (the same renderer "Where am I?" uses), YOLOX runs
 * on each view, every box is converted back into a direction on the sphere,
 * and duplicates seen from two overlapping views are merged.
 *
 * This module is pure: tensors in, detections out. Model loading lives in
 * objectModel.js, and the scene pipeline in objectIndex.js.
 *
 * Pre- and post-processing follow the official YOLOX ONNX demo
 * (demo/ONNXRuntime/onnx_inference.py and yolox/utils/demo_utils.py):
 * BGR input in 0..255 with no normalisation, raw grid outputs decoded with
 * strides 8/16/32, score = objectness x class probability, class-agnostic NMS
 * at IoU 0.45.
 */

const COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
    "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
    "scissors", "teddy bear", "hair drier", "toothbrush",
];

const STRIDES = [8, 16, 32];
const NMS_IOU = 0.45;
// Below this a detection is too uncertain to tag a scene with.
const DEFAULT_SCORE_THRESHOLD = 0.35;
// Views for detection: a ring at the horizon, wider than place recognition's
// views so most objects are seen whole in at least one, with 45° steps so
// neighbouring views overlap by half. The horizon ring reaches only about 45°
// above and below the horizon, so a second ring looks down at the floor and
// desks near the camera, where laptops, bags and chairs often sit.
const DETECT_VIEW_FOV_DEG = 90;
const DETECT_VIEW_STEP_DEG = 45;
const DETECT_DOWN_PITCH_DEG = -50; // renderView's convention: negative looks down
const DETECT_DOWN_STEP_DEG = 90;
// A view is skipped only when almost all of it falls on the uncovered black
// part of a partial panorama. Much looser than place recognition's limit: a
// half-covered view still shows whole objects worth detecting.
const DETECT_MAX_EMPTY_FRACTION = 0.8;
// Merging thresholds (see matchScore). Sightings from two views are compared
// over the region both views saw: they are one object when their boxes there
// coincide (IoU), or one is a looser box around the other (mostly contained,
// and not tiny beside it). At least MERGE_MIN_COMMON of one box must lie in
// that shared region, or there is too little to compare. Tuned on simulated
// scenes (single objects, rows, crowds, objects under the camera) and two
// real classroom panoramas.
const MERGE_MIN_IOU = 0.35;
const MERGE_MIN_CONTAINED = 0.75;
const MERGE_MIN_AREA_RATIO = 0.2;
const MERGE_MIN_COMMON = 0.3;
// Within one view, the detector sometimes reports the top part of an object
// as well as the whole of it (a person's head and shoulders next to their
// whole body), and NMS keeps both because their IoU is low.
const NESTED_MIN_INSIDE = 0.9;
const NESTED_MIN_AREA_RATIO = 0.2;
const NESTED_MAX_TOP_OFFSET = 0.1; // of the whole's height
// A box within this share of the view size from an edge is probably cut off.
const EDGE_MARGIN_FRACTION = 0.01;

const DEG = Math.PI / 180;

/** size x size RGB pixels to YOLOX's planar BGR float input, 0..255. */
function toModelInput(pixels, size) {
    const plane = size * size;
    const out = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i += 1) {
        out[i] = pixels[i * 3 + 2]; // B
        out[plane + i] = pixels[i * 3 + 1]; // G
        out[2 * plane + i] = pixels[i * 3]; // R
    }
    return out;
}

/**
 * Decodes raw YOLOX output and returns boxes above the score threshold.
 *
 * @param {Float32Array} output - (1, anchors, 5 + classes), flattened
 * @param {number} inputSize - square model input size
 * @returns {{ x1:number, y1:number, x2:number, y2:number, score:number, classIndex:number }[]}
 */
function decodeOutput(output, inputSize, scoreThreshold = DEFAULT_SCORE_THRESHOLD) {
    const stride = 5 + COCO_CLASSES.length;
    const boxes = [];
    let anchor = 0;
    for (const s of STRIDES) {
        const cells = Math.floor(inputSize / s);
        for (let gy = 0; gy < cells; gy += 1) {
            for (let gx = 0; gx < cells; gx += 1, anchor += 1) {
                const o = anchor * stride;
                const objectness = output[o + 4];
                if (objectness < scoreThreshold) continue; // score <= objectness
                let best = 0;
                let bestIndex = 0;
                for (let c = 0; c < COCO_CLASSES.length; c += 1) {
                    if (output[o + 5 + c] > best) {
                        best = output[o + 5 + c];
                        bestIndex = c;
                    }
                }
                const score = objectness * best;
                if (score < scoreThreshold) continue;
                const cx = (output[o] + gx) * s;
                const cy = (output[o + 1] + gy) * s;
                const w = Math.exp(output[o + 2]) * s;
                const h = Math.exp(output[o + 3]) * s;
                boxes.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score, classIndex: bestIndex });
            }
        }
    }
    if (anchor * stride !== output.length) {
        throw new Error(`YOLOX output has ${output.length / stride} anchors; expected ${anchor} for a ${inputSize}px input.`);
    }
    return boxes;
}

function iou(a, b) {
    const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
    const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    const inter = w * h;
    const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return union > 0 ? inter / union : 0;
}

/** Class-agnostic non-maximum suppression, as in the YOLOX demo. */
function nonMaxSuppression(boxes, iouThreshold = NMS_IOU) {
    const sorted = [...boxes].sort((a, b) => b.score - a.score);
    const kept = [];
    for (const box of sorted) {
        if (kept.every((other) => iou(box, other) <= iouThreshold)) kept.push(box);
    }
    return kept;
}

/**
 * Converts a point in a rendered view to a direction on the panorama, in
 * Marzipano's convention: yaw positive to the right, pitch positive DOWN.
 * This is the inverse of placeRecognition.renderView, whose internal pitch
 * is positive up, hence the sign flip on the way out.
 */
function viewPointToDirection(u, v, size, { yawDeg, pitchDeg = 0, fovDeg }) {
    const half = Math.tan((fovDeg * DEG) / 2);
    const x = ((u / size) * 2 - 1) * half;
    const y = -((v / size) * 2 - 1) * half;
    const len = Math.hypot(x, y, 1);
    const dx0 = x / len, dy0 = y / len, dz0 = 1 / len;
    const cp = Math.cos(pitchDeg * DEG), sp = Math.sin(pitchDeg * DEG);
    const cy = Math.cos(yawDeg * DEG), sy = Math.sin(yawDeg * DEG);
    const dy1 = dy0 * cp + dz0 * sp;
    const dz1 = -dy0 * sp + dz0 * cp;
    const dx = dx0 * cy + dz1 * sy;
    const dz = -dx0 * sy + dz1 * cy;
    const lon = Math.atan2(dx, dz);
    const lat = Math.asin(Math.max(-1, Math.min(1, dy1)));
    // Yaw in (-180, 180], the range place recognition uses, so the same
    // direction never appears as both -180 and 180. "+ 0" turns -0 into 0.
    let yaw = lon / DEG;
    if (yaw <= -180) yaw += 360;
    return { yawDeg: yaw + 0, pitchDeg: -lat / DEG + 0 };
}

/** Unit vector for a Marzipano-convention direction: x right, y up, z forward. */
function toVector({ yawDeg, pitchDeg }) {
    const yaw = yawDeg * DEG, lat = -pitchDeg * DEG;
    return [Math.cos(lat) * Math.sin(yaw), Math.sin(lat), Math.cos(lat) * Math.cos(yaw)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : null; };

/**
 * Turns one view's boxes into sphere-anchored sightings.
 *
 * Besides the centre direction, each sighting keeps what merging needs: the
 * view it came from and that view's axis, the directions of the box's four
 * corners, and whether the box touches the view's edge (and so is probably a
 * cut-off part of something larger).
 *
 * @param {object[]} boxes - from nonMaxSuppression
 * @param {number} size - view size in pixels
 * @param {{ yawDeg:number, pitchDeg?:number, fovDeg:number }} view
 * @param {string|number} [viewId] - identifies the view; defaults to its yaw and pitch
 */
function detectionsFromView(boxes, size, view, viewId = `${view.yawDeg}/${view.pitchDeg || 0}`) {
    const margin = size * EDGE_MARGIN_FRACTION;
    const at = (u, v) => toVector(viewPointToDirection(u, v, size, view));
    const axis = at(size / 2, size / 2);
    // The view's field of view as four planes through the camera, each given
    // by its inward normal: a direction is in view when it is on the inner
    // side of all four.
    const right = normalize(at(size, size / 2).map((x, i) => x - at(0, size / 2)[i]));
    const up = normalize(at(size / 2, 0).map((x, i) => x - at(size / 2, size)[i]));
    const t = Math.tan((view.fovDeg * DEG) / 2);
    const frustum = [
        right.map((x, i) => x + t * axis[i]),
        right.map((x, i) => t * axis[i] - x),
        up.map((x, i) => x + t * axis[i]),
        up.map((x, i) => t * axis[i] - x),
    ];
    return boxes.map((box) => {
        const x1 = Math.max(0, box.x1), y1 = Math.max(0, box.y1);
        const x2 = Math.min(size, box.x2), y2 = Math.min(size, box.y2);
        const centre = viewPointToDirection((x1 + x2) / 2, (y1 + y2) / 2, size, view);
        const centreVector = toVector(centre);
        return {
            label: COCO_CLASSES[box.classIndex],
            confidence: box.score,
            yawDeg: centre.yawDeg,
            pitchDeg: centre.pitchDeg,
            view: viewId,
            frustum,
            box: { x1, y1, x2, y2 },
            corners: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([u, v]) => toVector(viewPointToDirection(u, v, size, view))),
            centreVector,
            // How far off the view's axis the object was: smaller is less distorted.
            offAxis: Math.acos(Math.max(-1, Math.min(1, dot(axis, centreVector)))),
            clipped: box.x1 <= margin || box.y1 <= margin || box.x2 >= size - margin || box.y2 >= size - margin,
        };
    });
}

function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        area += x1 * y2 - x2 * y1;
    }
    return area / 2;
}

/** Intersection of two convex polygons, both counter-clockwise (Sutherland-Hodgman). */
function clipPolygon(subject, clip) {
    let output = subject;
    for (let i = 0; i < clip.length && output.length; i += 1) {
        const [ax, ay] = clip[i];
        const [bx, by] = clip[(i + 1) % clip.length];
        const inside = ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
        const cut = ([px, py], [qx, qy]) => {
            const a1 = by - ay, b1 = ax - bx, c1 = a1 * ax + b1 * ay;
            const a2 = qy - py, b2 = px - qx, c2 = a2 * px + b2 * py;
            const det = a1 * b2 - a2 * b1;
            return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
        };
        const input = output;
        output = [];
        for (let j = 0; j < input.length; j += 1) {
            const current = input[j];
            const previous = input[(j + input.length - 1) % input.length];
            if (inside(current)) {
                if (!inside(previous)) output.push(cut(previous, current));
                output.push(current);
            } else if (inside(previous)) {
                output.push(cut(previous, current));
            }
        }
    }
    return output;
}

/** Keeps the part of a polygon where k + ku*u + kw*w >= 0. */
function clipHalfPlane(points, k, ku, kw) {
    const value = ([u, w]) => k + ku * u + kw * w;
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const previous = points[(i + points.length - 1) % points.length];
        const vc = value(current), vp = value(previous);
        if ((vc >= 0) !== (vp >= 0)) {
            const f = vp / (vp - vc);
            out.push([previous[0] + f * (current[0] - previous[0]), previous[1] + f * (current[1] - previous[1])]);
        }
        if (vc >= 0) out.push(current);
    }
    return out;
}

/**
 * How two sightings' boxes overlap, compared on one image plane that faces
 * the point between them (a gnomonic projection keeps each box's edges
 * straight), and only over the region both views could see. Each view
 * reports only the part of an object inside it, so an object cut off by one
 * view's edge, or cut differently by two views, is compared on the part both
 * saw. Views at different pitches distort the same object differently; the
 * shared plane removes most of that.
 * @returns {{ iou:number, insideA:number, insideB:number, ratio:number } | null}
 */
function boxOverlap(a, b) {
    const axis = normalize([a.centreVector[0] + b.centreVector[0], a.centreVector[1] + b.centreVector[1], a.centreVector[2] + b.centreVector[2]]);
    if (!axis) return null;
    const right = normalize(cross([0, 1, 0], axis)) || [1, 0, 0];
    const up = cross(axis, right);
    const project = (corners) => {
        const points = [];
        for (const p of corners) {
            const depth = dot(p, axis);
            if (depth < 0.2) return null; // more than ~78° from the shared axis
            points.push([dot(p, right) / depth, dot(p, up) / depth]);
        }
        return polygonArea(points) < 0 ? points.reverse() : points;
    };
    let pa = project(a.corners);
    let pb = project(b.corners);
    if (!pa || !pb) return null;
    const clipToView = (points, frustum) => frustum.reduce(
        (poly, n) => (poly.length ? clipHalfPlane(poly, dot(n, axis), dot(n, right), dot(n, up)) : poly), points);
    const fullA = Math.abs(polygonArea(pa));
    const fullB = Math.abs(polygonArea(pb));
    pa = clipToView(pa, b.frustum);
    pb = clipToView(pb, a.frustum);
    if (pa.length < 3 || pb.length < 3) return null;
    const areaA = Math.abs(polygonArea(pa));
    const areaB = Math.abs(polygonArea(pb));
    if (areaA <= 0 || areaB <= 0) return null;
    const shared = clipPolygon(pa, pb);
    const inter = shared.length >= 3 ? Math.abs(polygonArea(shared)) : 0;
    return {
        iou: inter / (areaA + areaB - inter),
        insideA: inter / areaA,
        insideB: inter / areaB,
        ratio: Math.min(areaA, areaB) / Math.max(areaA, areaB),
        // Share of each box inside the region both views saw.
        coverA: fullA > 0 ? areaA / fullA : 0,
        coverB: fullB > 0 ? areaB / fullB : 0,
    };
}

/** Whether `part` is the detector re-describing the top part of `whole` (same view, pixel boxes). */
function isNestedPart(part, whole) {
    const p = part.box, w = whole.box;
    const inter = Math.max(0, Math.min(p.x2, w.x2) - Math.max(p.x1, w.x1)) * Math.max(0, Math.min(p.y2, w.y2) - Math.max(p.y1, w.y1));
    const partArea = (p.x2 - p.x1) * (p.y2 - p.y1);
    const wholeArea = (w.x2 - w.x1) * (w.y2 - w.y1);
    return partArea > 0 && inter / partArea >= NESTED_MIN_INSIDE
        && partArea >= NESTED_MIN_AREA_RATIO * wholeArea
        && Math.abs(p.y1 - w.y1) <= NESTED_MAX_TOP_OFFSET * (w.y2 - w.y1);
}

/**
 * Score (0 = no match) for two sightings of the same label being one object.
 * Sightings from the same view are one object only when one box is the top
 * part of the other; otherwise NMS already decided they are different. From
 * different views, the boxes are compared with boxOverlap, which also handles
 * objects cut off by either view's edge.
 */
function matchScore(s, m) {
    if (s.view === m.view) return isNestedPart(s, m) || isNestedPart(m, s) ? 1 : 0;
    const o = boxOverlap(s, m);
    // Too little of either box was visible to both views to compare them.
    if (!o || Math.max(o.coverA, o.coverB) < MERGE_MIN_COMMON) return 0;
    // Over what both views saw, the boxes coincide, or one is a looser box
    // around the same thing.
    const contained = Math.max(o.insideA, o.insideB) >= MERGE_MIN_CONTAINED && o.ratio >= MERGE_MIN_AREA_RATIO;
    return o.iou >= MERGE_MIN_IOU || contained ? Math.max(o.iou, o.ratio * Math.max(o.insideA, o.insideB)) : 0;
}

/**
 * Groups sightings of the same object from overlapping views.
 *
 * Every pair of same-label sightings is scored (see matchScore), and pairs are
 * joined strongest first, so each sighting ends up with the object it matches
 * best even when it also resembles a neighbour. Two groups are never joined
 * if each already holds a whole sighting from the same view (other than a
 * nested part): NMS decided those were different objects, which keeps
 * neighbours in a row or a crowd apart.
 */
function clusterSightings(detections) {
    const n = detections.length;
    const parent = detections.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const members = detections.map((d) => [d]);

    const pairs = [];
    for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
            if (detections[i].label !== detections[j].label) continue;
            const score = matchScore(detections[i], detections[j]);
            if (score > 0) pairs.push({ i, j, score });
        }
    }
    pairs.sort((a, b) => b.score - a.score);

    // Whole sightings from one view in two groups: different objects, unless
    // one is a nested part of the other.
    const conflict = (a, b) => a.some((x) => b.some((y) => x.view === y.view
        && !isNestedPart(x, y) && !isNestedPart(y, x)));
    for (const { i, j } of pairs) {
        const a = find(i), b = find(j);
        if (a === b || conflict(members[a], members[b])) continue;
        parent[b] = a;
        members[a] = members[a].concat(members[b]);
        members[b] = null;
    }
    return members.filter(Boolean).map((group) => ({ label: group[0].label, members: group }));
}

/** Marzipano-convention direction of a unit vector. */
function toDirection([x, y, z]) {
    let yawDeg = Math.atan2(x, z) / DEG;
    if (yawDeg <= -180) yawDeg += 360;
    return { yawDeg: yawDeg + 0, pitchDeg: -Math.asin(Math.max(-1, Math.min(1, y))) / DEG + 0 };
}

/**
 * Merged objects (see clusterSightings). Each is placed where the least
 * distorted whole sighting saw it. An object every view cut off (a person
 * standing close to the camera, say) is placed between its parts' centres,
 * since each part's centre leans towards the part that view could see.
 */
function mergeDetections(detections) {
    return clusterSightings(detections).map(({ label, members }) => {
        const whole = members.filter((m) => !m.clipped);
        const direction = whole.length
            ? whole.reduce((a, b) => (b.offAxis < a.offAxis ? b : a))
            : toDirection(normalize(members.reduce((sum, m) => sum.map((x, i) => x + m.centreVector[i]), [0, 0, 0])) || members[0].centreVector);
        let yawDeg = Math.round(direction.yawDeg * 10) / 10;
        if (yawDeg <= -180) yawDeg += 360;
        return {
            label,
            confidence: Math.round(Math.max(...members.map((m) => m.confidence)) * 1000) / 1000,
            yawDeg,
            pitchDeg: Math.round(direction.pitchDeg * 10) / 10,
        };
    });
}

/** Label counts, most frequent first, e.g. [{ label: 'chair', count: 6 }]. */
function summarize(detections) {
    const counts = new Map();
    for (const detection of detections) counts.set(detection.label, (counts.get(detection.label) || 0) + 1);
    return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The views each panorama is scanned in: the horizon ring (yaw -180 .. 135 in
 * 45° steps), then the downward ring. Pitch is in renderView's convention.
 */
function detectionViews() {
    const views = [];
    for (let yaw = -180; yaw < 180; yaw += DETECT_VIEW_STEP_DEG) views.push({ yawDeg: yaw, pitchDeg: 0, fovDeg: DETECT_VIEW_FOV_DEG });
    for (let yaw = -180; yaw < 180; yaw += DETECT_DOWN_STEP_DEG) views.push({ yawDeg: yaw, pitchDeg: DETECT_DOWN_PITCH_DEG, fovDeg: DETECT_VIEW_FOV_DEG });
    return views;
}

module.exports = {
    COCO_CLASSES,
    DEFAULT_SCORE_THRESHOLD,
    DETECT_VIEW_FOV_DEG,
    DETECT_MAX_EMPTY_FRACTION,
    toModelInput,
    decodeOutput,
    nonMaxSuppression,
    viewPointToDirection,
    detectionsFromView,
    boxOverlap,
    clusterSightings,
    mergeDetections,
    summarize,
    detectionViews,
};
