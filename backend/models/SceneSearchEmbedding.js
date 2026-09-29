const mongoose = require("mongoose");

// Text-search index for one scene: its panorama rendered as a ring of views,
// each embedded with CLIP's image encoder. Rebuilt whenever the scene's image,
// the model or the view layout changes, so `image` and `modelVersion` record
// what it was built from. Kept apart from SceneEmbedding (place recognition),
// which uses another model and another view layout.
const viewSchema = new mongoose.Schema({
    yawDeg: { type: Number, required: true },
    // Float32 embedding stored as raw bytes: 512 floats is 2 KB per view.
    vector: { type: Buffer, required: true },
}, { _id: false });

const sceneSearchEmbeddingSchema = new mongoose.Schema({
    sceneId: { type: mongoose.Schema.Types.ObjectId, ref: "Scene", required: true, unique: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    image: { type: String, required: true },
    modelVersion: { type: String, required: true },
    views: { type: [viewSchema], default: [] },
    // Views that fell on the uncovered part of a partial panorama.
    skippedViews: { type: Number, default: 0 },
    // Why a scene has no views (its image is not an uploaded file, or cannot
    // be decoded). Recorded so that it is not retried until the image changes.
    unsearchable: { type: String, default: null },
    builtAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SceneSearchEmbedding", sceneSearchEmbeddingSchema);
