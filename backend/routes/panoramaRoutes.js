const router = require("express").Router();
const upload = require("../middleware/uploadMiddleware");
const { createSession, getSession, streamSession, uploadPhoto, completeSession, finalizeSession } = require("../controllers/panoramaController");
const { requireAuth } = require("../middleware/authMiddleware");
const { sessionLimiter, uploadLimiter } = require("../middleware/rateLimit");

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

module.exports = router;
