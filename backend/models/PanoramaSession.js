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
    // Optional native-capture metadata (mobile app). Absent for browser uploads.
    frameId: { type: String },
    sequence: { type: Number },
    yaw: { type: Number },
    pitch: { type: Number },
    roll: { type: Number },
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

    // Set once the session's photos have been stitched and the panorama saved.
    // The source photos are deleted at that point, so this is the only record
    // of what the session produced.
    panorama: {
        type: {
            assetId: { type: mongoose.Schema.Types.ObjectId, ref: "Asset" },
            path: { type: String },
            sourceCount: { type: Number },
        },
        default: undefined,
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
