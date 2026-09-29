/**
 * Keeps AI-generated panorama pixels out of the features that must only see
 * what was photographed.
 *
 * A gap-filled panorama (services/panoramaFill.js) is saved with a mask of
 * the pixels the model generated. "Where am I?" and object detection treat
 * black as "not photographed", so blanking the generated pixels back to
 * black makes them ignore the invented floor and ceiling, rather than match
 * a visitor's photo against them or find objects that are not there.
 */

const sharp = require("sharp");
const Asset = require("../models/Asset");
const { resolveUploadFile } = require("./fileCleanup");

/**
 * Blanks the generated pixels of a decoded panorama, in place.
 * @param {string} file - the panorama's file in uploads/
 * @param {Buffer|Uint8Array} data - decoded RGB, info.width x info.height x 3
 * @param {{ width: number, height: number }} info
 * @returns {Promise<number>} how many pixels were blanked (0 for a photographed-only panorama)
 */
async function blankGeneratedPixels(file, data, info) {
    const filename = require("path").basename(file);
    const asset = await Asset.findOne({ filename, generatedMaskFilename: { $nin: [null, ""] } })
        .select("generatedMaskFilename").lean();
    if (!asset) return 0;
    let mask;
    try {
        mask = await sharp(resolveUploadFile(asset.generatedMaskFilename))
            .resize(info.width, info.height, { fit: "fill", kernel: "nearest" })
            .extractChannel(0).raw().toBuffer();
    } catch {
        return 0; // mask missing: nothing known to blank
    }
    let blanked = 0;
    for (let i = 0; i < mask.length; i += 1) {
        if (mask[i] > 127) { data[i * 3] = 0; data[i * 3 + 1] = 0; data[i * 3 + 2] = 0; blanked += 1; }
    }
    return blanked;
}

module.exports = { blankGeneratedPixels };
