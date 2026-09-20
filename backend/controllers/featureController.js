const crypto = require("crypto");
const Project = require("../models/Project");
const Scene = require("../models/Scene");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const { requireId, pickFields, sendError, withProject, validateEvent } = require("../services/integrity");

const graphFor = async (projectId) => {
  const scenes = await Scene.find({ projectId }).lean();
  const graph = new Map(scenes.map((scene) => [String(scene._id), []]));
  scenes.forEach((scene) => (scene.hotspots || []).forEach((spot) => {
    const target = String(spot.targetScene);
    if (graph.has(target)) graph.get(String(scene._id)).push({ id: target, cost: Math.max(1, Number(spot.distance) || 1) });
  }));
  return { scenes, graph };
};

const shortestPath = async (req, res) => {
  try {
    const { projectId, fromSceneId, toSceneId } = req.query;
    if (!projectId || !fromSceneId || !toSceneId) return res.status(400).json({ success: false, message: "projectId, fromSceneId and toSceneId are required." });
    const { scenes, graph } = await graphFor(projectId);
    if (!graph.has(fromSceneId) || !graph.has(toSceneId)) return res.status(404).json({ success: false, message: "One or both scenes were not found." });
    const distance = new Map([[fromSceneId, 0]]); const previous = new Map(); const queue = new Set(graph.keys());
    while (queue.size) {
      let current = [...queue].sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity))[0];
      if ((distance.get(current) ?? Infinity) === Infinity || current === toSceneId) break;
      queue.delete(current);
      for (const edge of graph.get(current)) {
        const candidate = distance.get(current) + edge.cost;
        if (candidate < (distance.get(edge.id) ?? Infinity)) { distance.set(edge.id, candidate); previous.set(edge.id, current); }
      }
    }
    if (!distance.has(toSceneId)) return res.status(404).json({ success: false, message: "No connected route exists between these scenes." });
    const ids = []; for (let id = toSceneId; id; id = previous.get(id)) { ids.unshift(id); if (id === fromSceneId) break; }
    const byId = new Map(scenes.map((scene) => [String(scene._id), scene]));
    res.json({ success: true, data: { distance: distance.get(toSceneId), path: ids.map((id) => ({ _id: id, name: byId.get(id)?.name || "Unknown scene" })) } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

const aiChat = async (req, res) => {
  try {
    const { message, projectId } = req.body;
    const scenes = projectId ? await Scene.find({ projectId }).select("name metadata hotspots").lean() : [];
    const context = scenes.map((s) => `${s.name} (${s.hotspots?.length || 0} connections)`).join(", ") || "No scenes created yet";
    if (process.env.GEMINI_API_KEY) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `You are SmartNav360's concise navigation assistant. Project scenes: ${context}. User: ${message}` }] }] }) });
      const data = await response.json();
      if (response.ok) return res.json({ success: true, data: { reply: data.candidates?.[0]?.content?.parts?.[0]?.text || "I could not generate a response." } });
    }
    res.json({ success: true, data: { reply: `I can help with this project. Available scenes: ${context}. Add GEMINI_API_KEY to backend/.env to enable Gemini answers.` } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

const trackEvent = async (req, res) => {
  try {
    const data = pickFields(req.body, ["projectId", "sceneId", "type", "sessionId", "metadata"]);
    requireId(data.projectId, "project ID");
    const event = await withProject(data.projectId, async (_project, session) => {
      await validateEvent(data, session);
      const [created] = await AnalyticsEvent.create([data], { session });
      return created;
    });
    res.status(201).json({ success: true, data: event });
  } catch (error) { sendError(res, error); }
};
const getAnalytics = async (req, res) => { try {
  const { projectId } = req.params; const events = await AnalyticsEvent.find({ projectId }).lean();
  const views = events.filter((event) => event.type === "view"); const sessions = new Set(events.map((event) => event.sessionId));
  const sceneViews = Object.entries(views.reduce((acc, event) => { const id = String(event.sceneId || "unknown"); acc[id] = (acc[id] || 0) + 1; return acc; }, {}));
  const scenes = await Scene.find({ projectId }).select("name").lean(); const names = new Map(scenes.map((scene) => [String(scene._id), scene.name]));
  res.json({ success: true, data: { totalEvents: events.length, visitors: sessions.size, sceneViews: sceneViews.map(([id, views]) => ({ sceneId: id, name: names.get(id) || "Unknown scene", views })).sort((a,b) => b.views-a.views), navigationCount: events.filter((event) => event.type === "navigation").length } });
} catch (error) { res.status(500).json({ success: false, message: error.message }); } };

const publishProject = async (req, res) => { try { const project = await Project.findById(req.params.id); if (!project) return res.status(404).json({ success: false, message: "Project not found." }); project.published = true; project.publishedAt = new Date(); project.shareToken ||= crypto.randomBytes(12).toString("hex"); await project.save(); res.json({ success: true, data: { shareToken: project.shareToken, publishedAt: project.publishedAt } }); } catch (error) { res.status(500).json({ success: false, message: error.message }); } };
const exportProject = async (req, res) => { try { const project = await Project.findById(req.params.id).lean(); if (!project) return res.status(404).json({ success: false, message: "Project not found." }); const scenes = await Scene.find({ projectId: project._id }).lean(); res.json({ success: true, data: { exportedAt: new Date().toISOString(), project, scenes } }); } catch (error) { res.status(500).json({ success: false, message: error.message }); } };
const getPublishedProject = async (req, res) => { try { const project = await Project.findOne({ shareToken: req.params.token, published: true }).lean(); if (!project) return res.status(404).json({ success: false, message: "Published project not found." }); const scenes = await Scene.find({ projectId: project._id }).lean(); res.json({ success: true, data: { project, scenes } }); } catch (error) { res.status(500).json({ success: false, message: error.message }); } };

module.exports = { shortestPath, aiChat, trackEvent, getAnalytics, publishProject, exportProject, getPublishedProject };
