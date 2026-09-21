const express = require("express");
const router = express.Router();

const upload = require("../middleware/uploadMiddleware");
const { uploadImage, getUploads, deleteAsset } = require("../controllers/uploadController");
const { requireAuth } = require("../middleware/authMiddleware");
const { uploadLimiter } = require("../middleware/rateLimit");

router.use(requireAuth);

router.get("/", getUploads);
// The limiter runs before multer, so a flood is rejected before any bytes of a
// 500 MB body are written to disk.
router.post("/", uploadLimiter, upload.single("image"), uploadImage);
router.delete("/:id", deleteAsset);

module.exports = router;
