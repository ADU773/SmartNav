const express = require("express");

const router = express.Router();

const upload = require("../middleware/uploadMiddleware");

const {
    uploadImage,
    getUploads,
    deleteAsset
} = require("../controllers/uploadController");

router.get("/", getUploads);

router.post("/", upload.single("image"), uploadImage);

router.delete("/:id", deleteAsset);

module.exports = router;