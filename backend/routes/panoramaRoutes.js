const router = require("express").Router();
const multer = require("multer");
const upload = require("../middleware/uploadMiddleware");
const { createSession, getSession, streamSession, uploadPhoto, completeSession, finalizeSession } = require("../controllers/panoramaController");
const { matchPanoramaFrames, MAX_FRAMES } = require("../controllers/matchController");
const { requireAuth } = require("../middleware/authMiddleware");
const { sessionLimiter, uploadLimiter, matchLimiter } = require("../middleware/rateLimit");

// Frames for feature matching are read from memory and never stored. The
// browser sends them already downscaled, so a few MB each is generous.
const matchUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: MAX_FRAMES, fields: 2 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

// Starting a session requires the project owner. Everything afterwards is
// authorized by the session token itself, because the phone that scans the QR
// code is not signed in — the token is the credential, and it expires in an hour.
router.post("/sessions", requireAuth, sessionLimiter, createSession);
router.get("/sessions/:token", getSession);
router.get("/sessions/:token/stream", streamSession);
router.post("/sessions/:token/photos", uploadLimiter, upload.single("image"), uploadPhoto);
router.post("/sessions/:token/complete", completeSession);
// Deletes the source photos after a stitch, so it needs the project owner,
// not just the session token a phone holds.
router.post("/sessions/:token/finalize", requireAuth, finalizeSession);

// Matches features between frames on the GPU; the browser registers the result.
router.post("/match", matchLimiter, requireAuth, matchUpload.array("image", MAX_FRAMES), matchPanoramaFrames);

module.exports = router;
