const mongoose = require("mongoose");

const sceneSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
        index: true,
    },

    name: {
        type: String,
        required: true,
    },

    image: {
        type: String,
        default: "",
    },

    hotspots: [
    {
        targetScene: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Scene",
            required: true,
        },

        label: {
            type: String,
            default: "",
        },

        yaw: {
            type: Number,
            default: 0,
        },

        pitch: {
            type: Number,
            default: 0,
        },

        distance: {
            type: Number,
            default: 0,
            },

        // How a visitor physically traverses this connection. The route finder
        // weights and optionally excludes edges by this value, which is what
        // turns the graph into accessibility-aware wayfinding.
        access: {
            type: String,
            enum: ["flat", "stairs", "ramp", "elevator", "door", "escalator"],
            default: "flat",
            },
        },
    ],

    metadata: {
        type: [String],
        default: [],
    },

    // Objects found in the panorama by the detector (services/objectIndex.js).
    // Written only by the server; the scene update API does not accept it.
    // Directions use the viewer's convention: yaw right-positive, pitch
    // down-positive, both in degrees.
    detections: {
        type: [{
            _id: false,
            label: { type: String, required: true },
            confidence: { type: Number, default: 0 },
            yawDeg: { type: Number, default: null },
            pitchDeg: { type: Number, default: null },
        }],
        default: [],
    },

    // Which model scanned the scene, when, and which image it saw.
    objectScan: {
        type: {
            modelVersion: String,
            scannedAt: Date,
            image: String,
        },
        default: undefined,
    },

    mapPosition: {
        type: {
            x: { type: Number, min: 0, max: 100 },
            y: { type: Number, min: 0, max: 100 },
        },
        default: undefined,
    },

    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model("Scene", sceneSchema);
