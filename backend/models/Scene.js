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
