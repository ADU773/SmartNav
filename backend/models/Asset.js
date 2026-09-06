const mongoose = require("mongoose");

const assetSchema = new mongoose.Schema({

    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
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

    uploadedAt: {
        type: Date,
        default: Date.now,
    },

});

module.exports = mongoose.model("Asset", assetSchema);
