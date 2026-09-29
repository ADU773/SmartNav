const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const sharp = require("sharp");
const Asset = require("../models/Asset");
const Project = require("../models/Project");
const { requireId, fail, sendError, withProject } = require("../services/integrity");
const { resolveUploadFile } = require("../services/fileCleanup");
const { deriveImageMetadata, removeDerivative } = require("../services/imagePipeline");
const { defineJob, enqueue, sendAccepted } = require("../services/jobs");
const { fillPanorama } = require("../services/panoramaFill");
const { inpaint, modelVersion, INPUT_SIZE } = require("../services/ml/inpaintModel");

const uploadDirectory = path.join(__dirname, "..", "uploads");
// The fill itself runs at this size (about the 512px views' own detail);
// the result is pasted into the panorama at its full resolution.
const WORK_WIDTH = 2048;
const MAX_OUTPUT_WIDTH = 8192;
const MAX_INPUT_PIXELS = 1_000_000_000;

/**
 * Fills the black gaps of one panorama asset and saves the result as a new
 * asset next to it. The original is never changed.
 */
async function fillAsset({ assetId, ownerId }, { progress }) {
    const source = await Asset.findById(assetId).lean();
    if (!source) fail(404, "Asset not found.");
    const file = resolveUploadFile(source.filename);

    progress(2, "Reading the panorama");
    let full;
    let work;
    try {
        full = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
            .resize({ width: MAX_OUTPUT_WIDTH, height: MAX_OUTPUT_WIDTH / 2, fit: "inside", withoutEnlargement: true })
            .removeAlpha().raw().toBuffer({ resolveWithObject: true });
        work = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
            .resize(WORK_WIDTH, WORK_WIDTH / 2, { fit: "fill" })
            .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch (error) {
        const unreadable = new Error("This image could not be read.");
        unreadable.status = 422;
        unreadable.cause = error;
        throw unreadable;
    }

    const result = await fillPanorama(new Uint8Array(work.data), WORK_WIDTH, WORK_WIDTH / 2, {
        inpaint,
        size: INPUT_SIZE,
        progress: (done, total) => progress(5 + (80 * done) / total, `Filling gaps: view ${done} of ${total}`),
    });
    if (result.gapFraction === 0) fail(422, "This panorama has no black gaps to fill.");
    if (result.filledFraction === 0) fail(422, "The black gaps are too far from anything photographed to fill.");

    progress(88, "Saving");
    const { width, height } = full.info;
    const mask = Buffer.from(result.generated.map((on) => (on ? 255 : 0)));
    // The fill and its mask, scaled to the panorama's full size.
    const [fillFull, maskFull] = await Promise.all([
        sharp(Buffer.from(result.rgb), { raw: { width: WORK_WIDTH, height: WORK_WIDTH / 2, channels: 3 } })
            .resize(width, height, { fit: "fill" }).raw().toBuffer(),
        sharp(mask, { raw: { width: WORK_WIDTH, height: WORK_WIDTH / 2, channels: 1 } })
            .resize(width, height, { fit: "fill" }).extractChannel(0).raw().toBuffer(),
    ]);
    const out = Buffer.from(full.data);
    for (let i = 0; i < maskFull.length; i += 1) {
        // Blend across the mask's soft (resampled) edge; photographed pixels stay as they were.
        const alpha = maskFull[i] / 255;
        if (alpha <= 0) continue;
        for (let c = 0; c < 3; c += 1) out[i * 3 + c] = Math.round(out[i * 3 + c] * (1 - alpha) + fillFull[i * 3 + c] * alpha);
    }

    const base = randomUUID();
    const filename = `${base}.jpg`;
    const maskFilename = `${base}-generated.png`;
    const filePath = resolveUploadFile(filename);
    let derived = null;
    let asset = null;
    try {
        await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toFile(filePath);
        await sharp(mask, { raw: { width: WORK_WIDTH, height: WORK_WIDTH / 2, channels: 1 } }).png().toFile(resolveUploadFile(maskFilename));
        derived = await deriveImageMetadata(filePath, filename);
        asset = await withProject(source.projectId, async (_project, session) => {
            const [created] = await Asset.create([{
                projectId: source.projectId,
                filename,
                originalName: `${path.parse(source.originalName || source.filename).name} (gaps filled).jpg`,
                path: `/uploads/${filename}`,
                ...derived,
                filledFrom: source._id,
                generatedMaskFilename: maskFilename,
                generatedFraction: Math.round(result.filledFraction * 1000) / 1000,
            }], { session });
            return created;
        }, { ownerId });
    } finally {
        if (!asset) {
            await fs.rm(filePath, { force: true });
            await fs.rm(resolveUploadFile(maskFilename), { force: true });
            await removeDerivative(uploadDirectory, derived?.thumbnailFilename).catch(() => {});
        }
    }

    return {
        asset: asset.toObject(),
        gapFraction: Math.round(result.gapFraction * 1000) / 1000,
        filledFraction: Math.round(result.filledFraction * 1000) / 1000,
        stillMissingFraction: Math.round((result.gapFraction - result.filledFraction) * 1000) / 1000,
        viewsFilled: result.viewsFilled,
        modelVersion: modelVersion(),
    };
}

// One fill at a time: it keeps every CPU core busy for a minute or two.
defineJob("fill-panorama", fillAsset, { concurrency: 1, maxWaiting: 5, timeoutMs: 20 * 60 * 1000 });

/**
 * POST /api/upload/:id/fill
 * Starts filling a panorama asset's black gaps; answers 202 with a job to poll.
 */
const startFill = async (req, res) => {
    try {
        requireId(req.params.id, "asset ID");
        const asset = await Asset.findById(req.params.id).select("projectId").lean();
        if (!asset) fail(404, "Asset not found.");
        // Filling creates an asset in the project, so it is an owner-only operation.
        if (!await Project.exists({ _id: asset.projectId, ownerId: req.user.id })) fail(404, "Asset not found.");
        const job = enqueue("fill-panorama", { assetId: String(asset._id), ownerId: req.user.id }, {
            ownerId: req.user.id,
            dedupeKey: `fill:${asset._id}`,
        });
        return sendAccepted(res, job);
    } catch (error) { return sendError(res, error); }
};

module.exports = { startFill, fillAsset };
