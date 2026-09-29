const path = require("path");

/**
 * Directory holding downloaded model weights and the per-machine device
 * timings. MODEL_CACHE_DIR moves it, for example to share one cache between
 * several checkouts; the default is backend/.cache/models.
 */
function modelCacheDir() {
    return process.env.MODEL_CACHE_DIR
        ? path.resolve(process.env.MODEL_CACHE_DIR)
        : path.join(__dirname, "..", ".cache", "models");
}

module.exports = { modelCacheDir };
