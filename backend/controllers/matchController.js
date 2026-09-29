const { fail, sendError } = require("../services/integrity");
const { matchFrames } = require("../services/frameMatching");
const { modelVersion, matcherDevice } = require("../services/featureMatchModel");

const MAX_FRAMES = 40;

/** Reads the `links` field: a JSON list of [from, to] frame indexes. */
function parseLinks(raw, frameCount) {
    let links;
    try {
        links = JSON.parse(raw);
    } catch {
        fail(400, "links must be a JSON list of [from, to] frame indexes.");
    }
    const valid = Array.isArray(links)
        && links.length > 0
        && links.length <= frameCount + 1
        && links.every((link) => Array.isArray(link) && link.length === 2
            && link.every((index) => Number.isInteger(index) && index >= 0 && index < frameCount)
            && link[0] !== link[1]);
    if (!valid) fail(400, "links must be a short list of [from, to] pairs, each naming two different uploaded frames.");
    return links;
}

/**
 * POST /api/panorama/match  (multipart: image x N, links)
 * Matches features between pairs of panorama frames on the GPU (when there is
 * one) and returns the correspondences for the browser to register.
 */
const matchPanoramaFrames = async (req, res) => {
    try {
        const files = req.files || [];
        if (files.length < 2) fail(400, "Send at least two frames as `image` fields.");
        if (files.length > MAX_FRAMES) fail(400, `Send at most ${MAX_FRAMES} frames.`);
        const links = parseLinks(req.body?.links, files.length);

        const started = process.hrtime.bigint();
        const result = await matchFrames(files.map((file) => file.buffer), links);
        res.json({
            success: true,
            data: {
                matcher: "superpoint-lightglue",
                modelVersion: modelVersion(),
                device: matcherDevice(),
                elapsedMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
                ...result,
            },
        });
    } catch (error) { sendError(res, error); }
};

module.exports = { matchPanoramaFrames, MAX_FRAMES };
