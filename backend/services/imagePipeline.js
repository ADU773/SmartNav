const path = require("path");
const fs = require("fs/promises");
const sharp = require("sharp");

const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_QUALITY = 78;
// Equirectangular panoramas are 2:1. Allow a little slack for near-2:1 crops.
const PANORAMIC_RATIO_TOLERANCE = 0.15;

// A 500 MB equirectangular image can decode to billions of pixels. sharp's
// default cap would reject legitimate panoramas, so raise it deliberately
// rather than disabling the guard entirely.
const MAX_INPUT_PIXELS = 1_000_000_000;

/**
 * Reads dimensions and writes a small WebP thumbnail beside the original.
 *
 * Never throws: an asset whose bytes sharp cannot decode is still a valid
 * upload (the format check in uploadMiddleware already passed), it simply has
 * no derived metadata. Callers treat every field as optional.
 *
 * @param {string} filePath - absolute path of the stored original.
 * @param {string} filename - stored filename, used to name the derivative.
 * @returns {Promise<{width, height, bytes, thumbnailPath, thumbnailFilename, isPanoramic}>}
 */
async function deriveImageMetadata(filePath, filename) {
    const empty = {
        width: null, height: null, bytes: null,
        thumbnailPath: "", thumbnailFilename: "", isPanoramic: false,
    };

    let stats;
    try {
        stats = await fs.stat(filePath);
    } catch {
        return empty;
    }

    let metadata;
    try {
        metadata = await sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
        return { ...empty, bytes: stats.size };
    }

    const width = metadata.width || null;
    const height = metadata.height || null;
    const ratio = width && height ? width / height : 0;
    const isPanoramic = Math.abs(ratio - 2) <= PANORAMIC_RATIO_TOLERANCE * 2;

    const thumbnailFilename = `${path.parse(filename).name}-thumb.webp`;
    const thumbnailAbsolute = path.join(path.dirname(filePath), thumbnailFilename);

    try {
        await sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS })
            .rotate() // honour EXIF orientation from phone cameras
            .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
            .webp({ quality: THUMBNAIL_QUALITY })
            .toFile(thumbnailAbsolute);
    } catch {
        return { width, height, bytes: stats.size, thumbnailPath: "", thumbnailFilename: "", isPanoramic };
    }

    return {
        width,
        height,
        bytes: stats.size,
        thumbnailPath: `/uploads/${thumbnailFilename}`,
        thumbnailFilename,
        isPanoramic,
    };
}

/**
 * Removes a derivative. Used when the asset it belongs to is rejected or
 * deleted; a missing file is not an error.
 */
async function removeDerivative(uploadDirectory, thumbnailFilename) {
    if (!thumbnailFilename) return;
    try {
        await fs.unlink(path.join(uploadDirectory, thumbnailFilename));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}

module.exports = { deriveImageMetadata, removeDerivative, THUMBNAIL_WIDTH };
