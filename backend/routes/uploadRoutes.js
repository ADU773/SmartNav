const express = require("express");

const router = express.Router();

const upload = require("../middleware/uploadMiddleware");

const {
    uploadImage,
    getUploads
} = require("../controllers/uploadController");

router.get("/", getUploads);

router.post("/", upload.single("image"), uploadImage);

module.exports = router;