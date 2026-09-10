const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        default: "",
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    published: { type: Boolean, default: false },
    shareToken: { type: String, unique: true, sparse: true },
    publishedAt: { type: Date },
    floorPlan: { type: String, default: "" },
});

module.exports = mongoose.model("Project", projectSchema);
