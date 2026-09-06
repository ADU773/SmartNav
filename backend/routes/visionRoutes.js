const router = require("express").Router();
const { detectObjects } = require("../controllers/visionController");
router.post("/detect", detectObjects);
module.exports = router;
