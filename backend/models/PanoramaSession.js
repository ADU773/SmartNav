const mongoose = require("mongoose");

const photoSchema = new mongoose.Schema({
    assetId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Asset",
        required: true,
    },
    path: {
        type: String,
        required: true,
    },
    uploadedAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: true });

const panoramaSessionSchema = new mongoose.Schema({

    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },

    token: {
        type: String,
        required: true,
        unique: true,
    },

    status: {
        type: String,
        enum: ["open", "done"],
        default: "open",
    },

    photos: {
        type: [photoSchema],
        default: [],
    },

    createdAt: {
        type: Date,
        default: Date.now,
    },

    // TTL index: MongoDB auto-deletes the document once this timestamp passes.
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 },
    },

});

module.exports = mongoose.model("PanoramaSession", panoramaSessionSchema);
