const mongoose = require("mongoose");

// Place-recognition index for one scene: its panorama rendered as a ring of
// views, each stored as a descriptor. Rebuilt whenever the scene's image or
// the model changes, so `image` and `modelVersion` record what it was built from.
const viewSchema = new mongoose.Schema({
    yawDeg: { type: Number, required: true },
    // Float32 descriptor stored as raw bytes: 768 floats is 3 KB per view.
    vector: { type: Buffer, required: true },
}, { _id: false });

const sceneEmbeddingSchema = new mongoose.Schema({
    sceneId: { type: mongoose.Schema.Types.ObjectId, ref: "Scene", required: true, unique: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    image: { type: String, required: true },
    modelVersion: { type: String, required: true },
    views: { type: [viewSchema], default: [] },
    // Views that fell on the uncovered part of a partial panorama.
    skippedViews: { type: Number, default: 0 },
    builtAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SceneEmbedding", sceneEmbeddingSchema);
