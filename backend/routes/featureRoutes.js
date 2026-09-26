const router = require("express").Router();
const features = require("../controllers/featureController");
const { requireAuth, optionalAuth } = require("../middleware/authMiddleware");

router.get("/navigation/path", requireAuth, features.shortestPath);
router.post("/ai/chat", requireAuth, features.aiChat);
// Anonymous visitors of a published tour emit analytics; the controller only
// accepts events for a published project unless the caller owns it.
router.post("/analytics/events", optionalAuth, features.trackEvent);
router.get("/analytics/projects/:projectId", requireAuth, features.getAnalytics);
router.post("/projects/:id/publish", requireAuth, features.publishProject);
router.get("/projects/:id/export", requireAuth, features.exportProject);
// Intentionally public: the share token is the credential, read-only, one project.
router.get("/published/:token", features.getPublishedProject);

module.exports = router;
