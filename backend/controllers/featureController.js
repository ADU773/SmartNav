const crypto = require("crypto");
const Project = require("../models/Project");
const Scene = require("../models/Scene");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const { ACCESS_MODES, requireId, pickFields, sendError, withProject, readableProject, validateEvent, fail } = require("../services/integrity");

// Relative effort of traversing each connection type. Multiplied into the
// edge's own distance, so a flight of stairs costs more than flat ground of
// the same length and the route finder prefers the gentler way round.
const ACCESS_WEIGHT = {
  flat: 1,
  door: 1.1,
  ramp: 1.2,
  elevator: 1.4,
  escalator: 1.5,
  stairs: 2.5,
};

const graphFor = async (projectId, { avoid = [] } = {}) => {
  const scenes = await Scene.find({ projectId }).lean();
  const graph = new Map(scenes.map((scene) => [String(scene._id), []]));
  scenes.forEach((scene) => (scene.hotspots || []).forEach((spot) => {
    const target = String(spot.targetScene);
    if (!graph.has(target)) return;
    const access = spot.access || "flat";
    // An excluded mode removes the edge entirely, which is what makes a
    // "no stairs" route genuinely step-free rather than merely cheaper.
    if (avoid.includes(access)) return;
    const base = Math.max(1, Number(spot.distance) || 1);
    graph.get(String(scene._id)).push({ id: target, cost: base * (ACCESS_WEIGHT[access] ?? 1), access });
  }));
  return { scenes, graph };
};

const shortestPath = async (req, res) => {
  try {
    const { projectId, fromSceneId, toSceneId } = req.query;
    if (!projectId || !fromSceneId || !toSceneId) return res.status(400).json({ success: false, message: "projectId, fromSceneId and toSceneId are required." });
    await readableProject(projectId, req.user.id);

    // `avoid=stairs,escalator` — anything not a known mode is rejected rather
    // than silently ignored, so a typo cannot quietly return a route with stairs.
    const avoid = String(req.query.avoid || "").split(",").map((mode) => mode.trim()).filter(Boolean);
    const unknown = avoid.filter((mode) => !ACCESS_MODES.includes(mode));
    if (unknown.length) fail(400, `Unknown access mode(s): ${unknown.join(", ")}. Valid modes: ${ACCESS_MODES.join(", ")}.`);

    const { scenes, graph } = await graphFor(projectId, { avoid });
    if (!graph.has(fromSceneId) || !graph.has(toSceneId)) return res.status(404).json({ success: false, message: "One or both scenes were not found." });
    const distance = new Map([[fromSceneId, 0]]); const previous = new Map(); const edgeInto = new Map(); const queue = new Set(graph.keys());
    while (queue.size) {
      let current = [...queue].sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity))[0];
      if ((distance.get(current) ?? Infinity) === Infinity || current === toSceneId) break;
      queue.delete(current);
      for (const edge of graph.get(current)) {
        const candidate = distance.get(current) + edge.cost;
        if (candidate < (distance.get(edge.id) ?? Infinity)) { distance.set(edge.id, candidate); previous.set(edge.id, current); edgeInto.set(edge.id, edge.access); }
      }
    }
    if (!distance.has(toSceneId)) {
      return res.status(404).json({
        success: false,
        message: avoid.length
          ? `No route exists between these scenes while avoiding ${avoid.join(", ")}.`
          : "No connected route exists between these scenes.",
      });
    }
    const ids = []; for (let id = toSceneId; id; id = previous.get(id)) { ids.unshift(id); if (id === fromSceneId) break; }
    const byId = new Map(scenes.map((scene) => [String(scene._id), scene]));
    res.json({ success: true, data: {
      distance: distance.get(toSceneId),
      avoided: avoid,
      path: ids.map((id) => ({ _id: id, name: byId.get(id)?.name || "Unknown scene", access: edgeInto.get(id) || null })),
    } });
  } catch (error) { sendError(res, error); }
};

const aiChat = async (req, res) => {
  try {
    const { message, projectId } = req.body;
    if (projectId) {
      requireId(projectId, "project ID");
      await readableProject(projectId, req.user.id);
    }
    const scenes = projectId ? await Scene.find({ projectId }).select("name metadata hotspots detections").lean() : [];
    // Detected objects let the assistant answer questions like "where is the
    // printer?" from what is actually visible in each panorama.
    const describe = (s) => {
      const objects = [...new Set((s.detections || []).map((d) => d.label))];
      return `${s.name} (${s.hotspots?.length || 0} connections${objects.length ? `; contains: ${objects.join(", ")}` : ""})`;
    };
    const context = scenes.map(describe).join("; ") || "No scenes created yet";
    if (process.env.GEMINI_API_KEY) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `You are SmartNav360's concise navigation assistant. Project scenes: ${context}. User: ${message}` }] }] }) });
      const data = await response.json();
      if (response.ok) return res.json({ success: true, data: { reply: data.candidates?.[0]?.content?.parts?.[0]?.text || "I could not generate a response." } });
      return res.status(502).json({ success: false, message: `Gemini could not answer: ${data.error?.message || "the provider rejected the request."}` });
    }
    res.json({ success: true, data: { reply: `I can help with this project. Available scenes: ${context}. Add GEMINI_API_KEY to backend/.env to enable Gemini answers.` } });
  } catch (error) { sendError(res, error); }
};

const trackEvent = async (req, res) => {
  try {
    const data = pickFields(req.body, ["projectId", "sceneId", "type", "sessionId", "metadata"]);
    requireId(data.projectId, "project ID");
    // Viewers of a published tour are anonymous, so this route accepts events
    // for any published project; unpublished projects still require the owner.
    const project = await Project.findById(data.projectId).select("ownerId published").lean();
    if (!project) fail(404, "Project not found.");
    if (!project.published && String(project.ownerId) !== req.user?.id) fail(404, "Project not found.");

    const event = await withProject(data.projectId, async (_project, session) => {
      await validateEvent(data, session);
      const [created] = await AnalyticsEvent.create([data], { session });
      return created;
    });
    res.status(201).json({ success: true, data: event });
  } catch (error) { sendError(res, error); }
};

const getAnalytics = async (req, res) => {
  try {
    const { projectId } = req.params;
    requireId(projectId, "project ID");
    await readableProject(projectId, req.user.id);

    const events = await AnalyticsEvent.find({ projectId }).sort({ createdAt: 1 }).lean();
    const views = events.filter((event) => event.type === "view");
    const sessions = new Set(events.map((event) => event.sessionId));
    const scenes = await Scene.find({ projectId }).select("name").lean();
    const names = new Map(scenes.map((scene) => [String(scene._id), scene.name]));

    // Dwell time: the gap between one view and the visitor's next event in the
    // same session. The final view of a session has no successor, so it is
    // excluded rather than counted as zero.
    const bySession = new Map();
    for (const event of events) {
      if (!bySession.has(event.sessionId)) bySession.set(event.sessionId, []);
      bySession.get(event.sessionId).push(event);
    }
    const dwellTotals = new Map();
    const dwellCounts = new Map();
    const MAX_DWELL_MS = 15 * 60 * 1000; // ignore gaps where the visitor clearly walked away
    for (const timeline of bySession.values()) {
      for (let i = 0; i < timeline.length - 1; i += 1) {
        const event = timeline[i];
        if (event.type !== "view" || !event.sceneId) continue;
        const delta = new Date(timeline[i + 1].createdAt) - new Date(event.createdAt);
        if (!Number.isFinite(delta) || delta <= 0 || delta > MAX_DWELL_MS) continue;
        const id = String(event.sceneId);
        dwellTotals.set(id, (dwellTotals.get(id) || 0) + delta);
        dwellCounts.set(id, (dwellCounts.get(id) || 0) + 1);
      }
    }

    const viewCounts = views.reduce((acc, event) => {
      const id = String(event.sceneId || "unknown");
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});

    const sceneViews = Object.entries(viewCounts).map(([id, count]) => ({
      sceneId: id,
      name: names.get(id) || "Unknown scene",
      views: count,
      averageDwellMs: dwellCounts.get(id) ? Math.round(dwellTotals.get(id) / dwellCounts.get(id)) : null,
    })).sort((a, b) => b.views - a.views);

    // Which connections visitors actually walk, for spotting dead ends.
    const transitions = events.filter((event) => event.type === "navigation" && event.metadata?.fromSceneId && event.sceneId)
      .reduce((acc, event) => {
        const key = `${event.metadata.fromSceneId}->${event.sceneId}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    const timeline = events.reduce((acc, event) => {
      const day = new Date(event.createdAt).toISOString().slice(0, 10);
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    res.json({ success: true, data: {
      totalEvents: events.length,
      visitors: sessions.size,
      navigationCount: events.filter((event) => event.type === "navigation").length,
      sceneViews,
      transitions: Object.entries(transitions).map(([key, count]) => {
        const [from, to] = key.split("->");
        return { from, fromName: names.get(from) || "Unknown scene", to, toName: names.get(to) || "Unknown scene", count };
      }).sort((a, b) => b.count - a.count),
      timeline: Object.entries(timeline).map(([date, count]) => ({ date, count })),
    } });
  } catch (error) { sendError(res, error); }
};

const publishProject = async (req, res) => {
  try {
    requireId(req.params.id, "project ID");
    const project = await Project.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!project) fail(404, "Project not found.");
    project.published = true;
    project.publishedAt = new Date();
    project.shareToken ||= crypto.randomBytes(24).toString("hex");
    await project.save();
    res.json({ success: true, data: { shareToken: project.shareToken, publishedAt: project.publishedAt } });
  } catch (error) { sendError(res, error); }
};

const exportProject = async (req, res) => {
  try {
    const project = await readableProject(req.params.id, req.user.id);
    const scenes = await Scene.find({ projectId: project._id }).lean();
    res.json({ success: true, data: { exportedAt: new Date().toISOString(), project, scenes } });
  } catch (error) { sendError(res, error); }
};

// The one intentionally public read path: the share token IS the credential,
// and it grants read-only access to exactly one published project.
const getPublishedProject = async (req, res) => {
  try {
    const token = String(req.params.token || "");
    if (!/^[a-f0-9]{16,64}$/i.test(token)) fail(404, "Published project not found.");
    const project = await Project.findOne({ shareToken: token, published: true })
      .select("-ownerId -__v")
      .lean();
    if (!project) fail(404, "Published project not found.");
    const scenes = await Scene.find({ projectId: project._id }).lean();
    res.json({ success: true, data: { project, scenes } });
  } catch (error) { sendError(res, error); }
};

module.exports = { shortestPath, aiChat, trackEvent, getAnalytics, publishProject, exportProject, getPublishedProject, ACCESS_WEIGHT };
