const router = require("express").Router();
const { detectObjects } = require("../controllers/visionController");
const { requireAuth } = require("../middleware/authMiddleware");
const { detectLimiter } = require("../middleware/rateLimit");

router.post("/detect", detectLimiter, requireAuth, detectObjects);

module.exports = router;
