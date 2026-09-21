const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
    // Every project belongs to exactly one account. All reads and writes are
    // scoped by this field; without it there is no multi-tenancy.
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
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

// The project list is always "this owner's projects, newest first".
projectSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model("Project", projectSchema);
