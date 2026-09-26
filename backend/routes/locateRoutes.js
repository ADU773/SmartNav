const router = require("express").Router();
const multer = require("multer");
const { locate, buildIndex, indexStatus } = require("../controllers/locateController");
const { requireAuth, optionalAuth } = require("../middleware/authMiddleware");
const { locateLimiter } = require("../middleware/rateLimit");

// The visitor's photo is only needed long enough to compute one descriptor,
// so it is kept in memory and never written to uploads/.
const photo = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 4 },
    fileFilter: (_req, file, cb) => {
        if (/^image\//.test(file.mimetype) || file.mimetype === "application/octet-stream") return cb(null, true);
        cb(new Error("Only image files can be located."));
    },
});

// Owners locate by project ID; anonymous visitors of a published tour by its
// share token. The controller decides which applies.
router.post("/", locateLimiter, optionalAuth, photo.single("image"), locate);
router.post("/projects/:projectId/index", requireAuth, buildIndex);
router.get("/projects/:projectId/status", requireAuth, indexStatus);

module.exports = router;
