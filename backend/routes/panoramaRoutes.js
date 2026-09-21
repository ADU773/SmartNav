const router = require("express").Router();
const upload = require("../middleware/uploadMiddleware");
const { createSession, getSession, uploadPhoto, completeSession } = require("../controllers/panoramaController");

router.post("/sessions", createSession);
router.get("/sessions/:token", getSession);
router.post("/sessions/:token/photos", upload.single("image"), uploadPhoto);
router.post("/sessions/:token/complete", completeSession);

module.exports = router;
