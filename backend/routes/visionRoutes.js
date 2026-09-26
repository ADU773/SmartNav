const router = require("express").Router();
const { detectObjects } = require("../controllers/visionController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/detect", requireAuth, detectObjects);

module.exports = router;
