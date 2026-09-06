const mongoose = require("mongoose");

const analyticsEventSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  sceneId: { type: mongoose.Schema.Types.ObjectId, ref: "Scene", index: true },
  type: { type: String, enum: ["view", "navigation", "search"], required: true },
  sessionId: { type: String, default: "anonymous" },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
