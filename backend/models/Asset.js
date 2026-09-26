const mongoose = require("mongoose");

const assetSchema = new mongoose.Schema({

    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
        index: true,
    },

    filename: {
        type: String,
        required: true,
    },

    originalName: {
        type: String,
        default: "",
    },

    path: {
        type: String,
        required: true,
    },

    // Derived at upload time by services/imagePipeline.js. Absent on assets
    // created before the pipeline existed, and on files sharp cannot decode.
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },
    // Small WebP preview served to grids and pickers instead of the full
    // multi-megabyte panorama.
    thumbnailPath: { type: String, default: "" },
    thumbnailFilename: { type: String, default: "" },
    // A 2:1 aspect ratio is the equirectangular convention, so this is a good
    // hint that an asset is usable as a 360° scene image.
    isPanoramic: { type: Boolean, default: false },

    uploadedAt: {
        type: Date,
        default: Date.now,
    },

});

// Asset lists are always "this project's assets, newest first".
assetSchema.index({ projectId: 1, uploadedAt: -1 });

module.exports = mongoose.model("Asset", assetSchema);
