/**
 * Registers panorama frames against each other on the server.
 *
 * The browser sends its working-resolution frames; this decodes each one to
 * grayscale, runs SuperPoint + LightGlue on each requested pair (see
 * featureMatchModel.js) and returns the matches as pixel coordinates in the
 * frames as they were uploaded, so the browser's registration code can use
 * them exactly as it uses its own matches.
 *
 * This module only finds correspondences. Deciding which of them are right
 * (RANSAC over a rotation-only camera, focal length, loop closure) stays in
 * the frontend, where the sensor data lives.
 */

const sharp = require("sharp");
const { matchImages, MODEL_EDGE } = require("./featureMatchModel");

/** Matches LightGlue is less sure of than this are dropped before RANSAC sees them. */
const MIN_SCORE = 0.2;
const MAX_INPUT_PIXELS = 50e6;

/** Model dimensions for a frame: long edge MODEL_EDGE, both multiples of 8. */
function modelSize(width, height) {
    const scale = Math.min(1, MODEL_EDGE / Math.max(width, height));
    const round8 = (value) => Math.max(64, Math.round((value * scale) / 8) * 8);
    return { width: round8(width), height: round8(height) };
}

/**
 * @param {Buffer[]} buffers - encoded images (JPEG, PNG or WebP)
 * @param {[number, number][]} links - pairs of indexes into `buffers`
 * @returns {Promise<{ frames: { width: number, height: number }[], pairs: { from: number, to: number, matches: number[][] }[] }>}
 *   each match is [x1, y1, x2, y2, score] in the uploaded frames' pixels
 */
async function matchFrames(buffers, links) {
    const frames = await Promise.all(buffers.map(async (buffer) => {
        const unreadable = () => Object.assign(new Error("A frame could not be read as an image."), { status: 400 });
        const { width, height } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata().catch(() => { throw unreadable(); });
        if (!width || !height) throw unreadable();
        return { buffer, width, height };
    }));

    // Decoded lazily and remembered: each frame is normally used by two pairs.
    const decoded = new Map();
    const grayscale = (index, size) => {
        const key = `${index}:${size.width}x${size.height}`;
        if (!decoded.has(key)) {
            decoded.set(key, sharp(frames[index].buffer, { limitInputPixels: MAX_INPUT_PIXELS })
                .greyscale()
                .resize({ width: size.width, height: size.height, fit: "fill" })
                .raw()
                .toBuffer());
        }
        return decoded.get(key);
    };

    const pairs = [];
    for (const [from, to] of links) {
        const size = modelSize(frames[from].width, frames[from].height);
        const [a, b] = await Promise.all([grayscale(from, size), grayscale(to, size)]);
        const plane = size.width * size.height;
        const pixels = new Float32Array(plane * 2);
        for (let i = 0; i < plane; i += 1) {
            pixels[i] = a[i] / 255;
            pixels[plane + i] = b[i] / 255;
        }

        const result = await matchImages(pixels, size.width, size.height);
        // Model pixels back to uploaded-frame pixels. The second frame is squashed to the
        // first's size when their aspect ratios differ, so each has its own scale.
        const ax = frames[from].width / size.width;
        const ay = frames[from].height / size.height;
        const bx = frames[to].width / size.width;
        const by = frames[to].height / size.height;
        const matches = [];
        for (const { from: i, to: j, score } of result.matches) {
            if (score < MIN_SCORE) continue;
            matches.push([
                result.pointsA[i * 2] * ax,
                result.pointsA[i * 2 + 1] * ay,
                result.pointsB[j * 2] * bx,
                result.pointsB[j * 2 + 1] * by,
                Math.round(score * 1000) / 1000,
            ]);
        }
        pairs.push({ from, to, matches });
    }

    return { frames: frames.map(({ width, height }) => ({ width, height })), pairs };
}

module.exports = { matchFrames, modelSize, MIN_SCORE };
