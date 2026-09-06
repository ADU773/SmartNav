const express = require("express");

const router = express.Router();


const {

    createScene,
    getScenes,
    getSceneById,
    updateScene,
    deleteScene,
    connectScenes

} = require("../controllers/sceneController");

router.post("/", createScene);

router.get("/", getScenes);

router.get("/:id", getSceneById);

router.put("/:id", updateScene);

router.delete("/:id", deleteScene);

router.post("/:id/connect", connectScenes);

module.exports = router;