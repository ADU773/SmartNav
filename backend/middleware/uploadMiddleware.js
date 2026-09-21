const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const uploadDirectory = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

const imageTypes = new Map([
    [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
    [".png", "image/png"], [".webp", "image/webp"], [".gif", "image/gif"],
]);
const storage = multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, cb) => {
        cb(null, randomUUID() + path.extname(file.originalname).toLowerCase());
    },
});

const upload = multer({
    storage,
    // High-resolution equirectangular 360° panoramas can be several hundred MB.
    limits: { fileSize: 500 * 1024 * 1024, files: 1, fields: 1 },
    fileFilter: (req, file, cb) => {
        const expectedType = imageTypes.get(path.extname(file.originalname).toLowerCase());
        if (expectedType && (file.mimetype === expectedType || file.mimetype === "application/octet-stream")) {
            return cb(null, true);
        }
        cb(new Error("Only JPG, PNG, WebP, and GIF images are supported. Convert SVG or EXR files before uploading."));
    },
});

// MIME headers are client-controlled. Verify the stored bytes as well.
// This identifies formats; it is not a full image decoder or malware scanner.
async function validateImage(file) {
    const handle = await fs.promises.open(file.path, "r");
    try {
        const header = Buffer.alloc(12);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const extension = path.extname(file.filename).toLowerCase();
        const matches = bytesRead >= 12 && (
            ((extension === ".jpg" || extension === ".jpeg") && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) ||
            (extension === ".png" && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
            (extension === ".gif" && ["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6))) ||
            (extension === ".webp" && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP")
        );
        if (!matches) {
            const error = new Error("The file contents do not match a supported image format.");
            error.status = 400;
            throw error;
        }
    } finally {
        await handle.close();
    }
}

module.exports = upload;
module.exports.validateImage = validateImage;
