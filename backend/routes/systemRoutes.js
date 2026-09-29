const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { getJob } = require("../services/jobs");
const modelStore = require("../services/modelStore");

// Every model module registers itself with the model store when required, so
// the status list only includes models whose feature code is loaded. The
// routes that use them are mounted before this router, so they all are.

/** GET /api/jobs/:id — progress and result of a background job you started. */
router.get("/jobs/:id", requireAuth, (req, res) => {
    const job = /^[a-f0-9]{24}$/.test(req.params.id) ? getJob(req.params.id, req.user.id) : null;
    if (!job) return res.status(404).json({ success: false, message: "Job not found. Finished jobs are kept for an hour." });
    res.json({ success: true, data: job });
});

/** GET /api/system/models — which AI models exist, whether they are downloaded, and where they run. */
router.get("/system/models", requireAuth, (_req, res) => {
    res.json({ success: true, data: modelStore.status() });
});

module.exports = router;
