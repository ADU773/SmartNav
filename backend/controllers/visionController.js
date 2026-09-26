const Scene = require("../models/Scene");
const Project = require("../models/Project");

// Connects to a self-hosted YOLO service (for example an Ultralytics FastAPI endpoint).
// Keeping inference outside the web server avoids bundling a multi-gigabyte model with this app.
const detectObjects = async (req, res) => {
  try {
    const { sceneId } = req.body;
    const scene = await Scene.findById(sceneId);
    if (!scene) return res.status(404).json({ success: false, message: "Scene not found." });
    // Detection mutates scene.metadata, so it is an owner-only operation.
    if (!await Project.exists({ _id: scene.projectId, ownerId: req.user.id })) {
      return res.status(404).json({ success: false, message: "Scene not found." });
    }
    if (!process.env.YOLO_API_URL) return res.status(503).json({ success: false, message: "YOLO is ready to connect. Add YOLO_API_URL to backend/.env for your detector service." });
    const response = await fetch(process.env.YOLO_API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: `${req.protocol}://${req.get("host")}${scene.image}`, sceneId }) });
    if (!response.ok) return res.status(502).json({ success: false, message: "YOLO service did not accept the image." });
    const result = await response.json();
    const labels = [...new Set((result.detections || result.results || []).map((item) => item.label || item.class).filter(Boolean))];
    scene.metadata = [...new Set([...(scene.metadata || []), ...labels])];
    await scene.save();
    res.json({ success: true, data: { detections: result.detections || result.results || [], labels } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

module.exports = { detectObjects };
