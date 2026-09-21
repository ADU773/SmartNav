const express = require("express");
const router = express.Router();

const {
    createScene,
    getScenes,
    getSceneById,
    updateScene,
    deleteScene,
    connectScenes,
} = require("../controllers/sceneController");
const { requireAuth } = require("../middleware/authMiddleware");

// Scenes are always reached through a project the caller owns. Public viewing
// of a published tour goes through /api/published/:token instead.
router.use(requireAuth);

router.post("/", createScene);
router.get("/", getScenes);
router.get("/:id", getSceneById);
router.put("/:id", updateScene);
router.delete("/:id", deleteScene);
router.post("/:id/connect", connectScenes);

module.exports = router;
