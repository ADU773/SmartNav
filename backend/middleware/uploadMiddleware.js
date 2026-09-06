const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDirectory = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadDirectory);
    },

    filename: function (req, file, cb) {

        const uniqueName = Date.now() + path.extname(file.originalname);

        cb(null, uniqueName);
    }

});

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/x-exr", "application/octet-stream"]);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".exr"]);

const upload = multer({
    storage,
    // High-resolution equirectangular 360° panoramas are commonly 20–60 MB.
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        if (allowedExtensions.has(extension) && imageTypes.has(file.mimetype)) return cb(null, true);
        cb(new Error("Only JPG, PNG, WebP, GIF, SVG, and EXR panorama files are supported."));
    },
});

module.exports = upload;    
