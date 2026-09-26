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
// Two sightings of the same class from different views are one object when
// this much of the smaller one's angular footprint lies inside the other's.
// Measured on footprints, not centre distance, so an object cut off at one
// view's edge still matches the whole sighting from the next view.
const MERGE_MIN_OVERLAP = 0.5;
// A box this close to the view's edge is probably cut off by it.
const EDGE_MARGIN_PX = 2;

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

/** Wraps an angle in degrees into (-180, 180]. */
function wrapDeg(angle) {
    let a = angle % 360;
    if (a > 180) a -= 360;
    if (a <= -180) a += 360;
    return a;
}

/**
 * Turns one view's boxes into sphere-anchored detections.
 *
 * Besides the centre direction, each detection keeps what merging needs: the
 * view it came from, its angular footprint (yaw and pitch ranges, with yaw
 * relative to the centre so the ±180° seam is harmless), and whether the box
 * touches the view's edge.
 *
 * @param {object[]} boxes - from nonMaxSuppression
 * @param {number} size - view size in pixels
 * @param {{ yawDeg:number, pitchDeg?:number, fovDeg:number }} view
 * @param {string|number} [viewId] - identifies the view; defaults to its yaw and pitch
 */
function detectionsFromView(boxes, size, view, viewId = `${view.yawDeg}/${view.pitchDeg || 0}`) {
    return boxes.map((box) => {
        const x1 = Math.max(0, box.x1), y1 = Math.max(0, box.y1);
        const x2 = Math.min(size, box.x2), y2 = Math.min(size, box.y2);
        const centre = viewPointToDirection((x1 + x2) / 2, (y1 + y2) / 2, size, view);
        const xs = [x1, (x1 + x2) / 2, x2];
        const ys = [y1, (y1 + y2) / 2, y2];
        const outline = xs.flatMap((x) => ys.map((y) => viewPointToDirection(x, y, size, view)));
        const yawOffsets = outline.map((point) => wrapDeg(point.yawDeg - centre.yawDeg));
        const pitches = outline.map((point) => point.pitchDeg);
        return {
            label: COCO_CLASSES[box.classIndex],
            confidence: box.score,
            yawDeg: centre.yawDeg,
            pitchDeg: centre.pitchDeg,
            view: viewId,
            footprint: {
                yawMin: Math.min(...yawOffsets), yawMax: Math.max(...yawOffsets),
                pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches),
            },
            clipped: box.x1 <= EDGE_MARGIN_PX || box.y1 <= EDGE_MARGIN_PX
                || box.x2 >= size - EDGE_MARGIN_PX || box.y2 >= size - EDGE_MARGIN_PX,
        };
    });
}

/** Share of the smaller footprint that lies inside the other one (0..1). */
function footprintOverlap(a, b) {
    const shift = wrapDeg(b.yawDeg - a.yawDeg);
    const yaw = Math.min(a.footprint.yawMax, shift + b.footprint.yawMax) - Math.max(a.footprint.yawMin, shift + b.footprint.yawMin);
    const pitch = Math.min(a.footprint.pitchMax, b.footprint.pitchMax) - Math.max(a.footprint.pitchMin, b.footprint.pitchMin);
    if (yaw <= 0 || pitch <= 0) return 0;
    const area = (d) => (d.footprint.yawMax - d.footprint.yawMin) * (d.footprint.pitchMax - d.footprint.pitchMin);
    const smaller = Math.min(area(a), area(b));
    return smaller > 0 ? (yaw * pitch) / smaller : 0;
}

/**
 * Merges sightings of the same object from overlapping views.
 *
 * Only sightings from different views are merged: within one view, NMS has
 * already separated neighbouring objects, so five people sitting side by side
 * stay five. Across views, a sighting joins the object whose footprint it
 * overlaps most (same label, MERGE_MIN_OVERLAP or more), and each object takes
 * at most one sighting per view. Whole sightings are placed first, so an
 * object's direction comes from a view that saw all of it, not from one that
 * cut it off.
 */
function mergeDetections(detections) {
    const ordered = [...detections].sort((a, b) => Number(a.clipped) - Number(b.clipped) || b.confidence - a.confidence);
    const objects = [];
    for (const sighting of ordered) {
        let best = null;
        let bestOverlap = MERGE_MIN_OVERLAP;
        for (const object of objects) {
            if (object.main.label !== sighting.label || object.views.has(sighting.view)) continue;
            const overlap = footprintOverlap(object.main, sighting);
            if (overlap >= bestOverlap) { best = object; bestOverlap = overlap; }
        }
        if (best) {
            best.views.add(sighting.view);
            best.confidence = Math.max(best.confidence, sighting.confidence);
        } else {
            objects.push({ main: sighting, views: new Set([sighting.view]), confidence: sighting.confidence });
        }
    }
    return objects.map(({ main, confidence }) => ({
        label: main.label,
        confidence: Math.round(confidence * 1000) / 1000,
        yawDeg: Math.round(main.yawDeg * 10) / 10,
        pitchDeg: Math.round(main.pitchDeg * 10) / 10,
    }));
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
    footprintOverlap,
    mergeDetections,
    summarize,
    detectionViews,
};
