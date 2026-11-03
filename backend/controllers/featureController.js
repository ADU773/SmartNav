const crypto = require("crypto");
const Project = require("../models/Project");
const Scene = require("../models/Scene");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const chatModel = require("../services/ml/chatModel");
const geminiChat = require("../services/geminiChat");
const openaiChat = require("../services/openaiChat");
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
    // The owner can route in any of their projects; anyone else, including a
    // visitor who is not signed in, only in a published one.
    requireId(projectId, "project ID");
    const owned = req.user && await Project.exists({ _id: projectId, ownerId: req.user.id });
    if (!owned && !await Project.exists({ _id: projectId, published: true })) fail(404, "Project not found.");

    // `avoid=stairs,escalator` — anything not a known mode is rejected rather
    // than silently ignored, so a typo cannot quietly return a route with stairs.
    const avoid = String(req.query.avoid || "").split(",").map((mode) => mode.trim()).filter(Boolean);
    const unknown = avoid.filter((mode) => !ACCESS_MODES.includes(mode));
    if (unknown.length) fail(400, `Unknown access mode(s): ${unknown.join(", ")}. Valid modes: ${ACCESS_MODES.join(", ")}.`);

    const { scenes, graph } = await graphFor(projectId, { avoid });
    if (!graph.has(fromSceneId) || !graph.has(toSceneId)) return res.status(404).json({ success: false, message: "One or both scenes were not found." });
    const route = routeBetween(scenes, graph, fromSceneId, toSceneId);
    if (!route) {
      return res.status(404).json({
        success: false,
        message: avoid.length
          ? `No route exists between these scenes while avoiding ${avoid.join(", ")}.`
          : "No connected route exists between these scenes.",
      });
    }
    res.json({ success: true, data: { ...route, avoided: avoid } });
  } catch (error) { sendError(res, error); }
};

/**
 * Dijkstra over the scene graph. Returns { distance, path } with each step's
 * scene and the access mode used to reach it, or null when no route exists.
 */
function routeBetween(scenes, graph, fromSceneId, toSceneId) {
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
  if (!distance.has(toSceneId)) return null;
  const ids = []; for (let id = toSceneId; id; id = previous.get(id)) { ids.unshift(id); if (id === fromSceneId) break; }
  const byId = new Map(scenes.map((scene) => [String(scene._id), scene]));
  return {
    distance: distance.get(toSceneId),
    path: ids.map((id) => ({ _id: id, name: byId.get(id)?.name || "Unknown scene", access: edgeInto.get(id) || null })),
  };
}

/**
 * Which models answer in the AI Workspace, in the order to try them:
 * "openai" (OPENAI_API_KEY), "gemini" (GEMINI_API_KEY) or "local" (Qwen3-4B
 * run in this process, no key). Unset or "auto" tries every API with a key,
 * OpenAI first, so an account without credits falls back to the other. The
 * retired "ollama" setting means local.
 */
function chatProviders() {
  const setting = process.env.LLM_PROVIDER || "auto";
  if (setting === "local" || setting === "ollama") return ["local"];
  if (setting === "openai" || setting === "gemini") return [setting];
  const withKeys = [process.env.OPENAI_API_KEY && "openai", process.env.GEMINI_API_KEY && "gemini"].filter(Boolean);
  return withKeys.length ? withKeys : ["gemini"]; // Gemini then reports the missing key
}

/** The first provider tried; "local" means the model runs in this process. */
const chatProvider = () => chatProviders()[0];

const CHAT_PROVIDERS = {
  openai: { reply: (input) => openaiChat.reply(input), model: () => process.env.OPENAI_MODEL || openaiChat.DEFAULT_MODEL },
  gemini: { reply: (input) => geminiChat.reply(input), model: () => process.env.GEMINI_MODEL || geminiChat.DEFAULT_MODEL },
  local: { reply: (input) => chatModel.reply(input), model: () => chatModel.modelVersion() },
};

const CHAT_MAX_MESSAGE_CHARS = 2000;
// Owner-written instructions added to every conversation in a project.
const CHAT_MAX_INSTRUCTIONS_CHARS = 1500;
// The local model's window is 8192 tokens. The reply may use 768, the message
// up to ~700 (2000 characters), earlier turns up to ~1700 (6000 characters),
// and the rules, tools and owner's instructions ~1000. The project data gets
// what is left, counted at a cautious 3 characters per token.
const CHAT_CONTEXT_CHARS = 12000;
const CHAT_HISTORY_CHARS = 6000;
const CHAT_HISTORY_TURNS = 8;
const CHAT_OBJECTS_PER_SCENE = 12;
const CHAT_CONNECTIONS_PER_SCENE = 10;
const STEP_FREE_AVOID = ["stairs", "escalator"];

/**
 * Describes the project's scenes for the assistant within a fixed size, so a
 * large project cannot overflow the model's window: each scene with the
 * scenes it leads to (and how that connection is walked) and its most
 * frequent detected objects with counts.
 */
function chatContext(scenes, budget = CHAT_CONTEXT_CHARS) {
  if (!scenes.length) return "No scenes created yet.";
  const names = new Map(scenes.map((scene) => [String(scene._id), String(scene.name).slice(0, 80)]));
  const lines = [];
  let used = 0;
  for (const [index, scene] of scenes.entries()) {
    const connections = (scene.hotspots || [])
      .filter((spot) => names.has(String(spot.targetScene)))
      .slice(0, CHAT_CONNECTIONS_PER_SCENE)
      .map((spot) => `${names.get(String(spot.targetScene))} (${spot.access || "flat"}${spot.label ? `, "${String(spot.label).slice(0, 40)}"` : ""})`);
    const counts = new Map();
    for (const { label } of scene.detections || []) if (label) counts.set(label, (counts.get(label) || 0) + 1);
    const objects = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, CHAT_OBJECTS_PER_SCENE)
      .map(([label, count]) => (count > 1 ? `${label} x${count}` : label));
    const line = `${index + 1}. ${names.get(String(scene._id))}`
      + ` | leads to: ${connections.length ? connections.join(", ") : "nothing"}`
      + ` | objects: ${objects.length ? objects.join(", ") : "none detected"}`;
    if (used + line.length + 1 > budget) {
      const remaining = scenes.length - index;
      lines.push(`...and ${remaining} more scene${remaining === 1 ? "" : "s"} not listed.`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** Earlier turns sent by the browser, checked and trimmed to fit the window. */
function chatHistory(history) {
  if (history === undefined) return [];
  if (!Array.isArray(history)) fail(400, "history must be a list of messages.");
  const turns = history.slice(-CHAT_HISTORY_TURNS).map((turn) => {
    if (!turn || !["user", "assistant"].includes(turn.role) || typeof turn.content !== "string") {
      fail(400, "Each history message needs a role (user or assistant) and text content.");
    }
    return { role: turn.role, content: turn.content.slice(0, CHAT_MAX_MESSAGE_CHARS) };
  });
  // Keep the most recent turns that fit, then make sure the kept part does not
  // start with an assistant reply to a question that was dropped.
  const kept = [];
  let used = 0;
  for (const turn of turns.reverse()) {
    if (used + turn.content.length > CHAT_HISTORY_CHARS) break;
    kept.unshift(turn);
    used += turn.content.length;
  }
  while (kept.length && kept[0].role !== "user") kept.shift();
  return kept;
}

const simplify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Finds the scene a name refers to: an exact match, else the scene sharing the
 * most whole words with it ("lab 2" finds "Computer Lab 2"). Whole words, so
 * "Cafeteria" does not match a scene called "A".
 */
function matchScene(scenes, name) {
  const wanted = simplify(name);
  if (!wanted) return null;
  const exact = scenes.find((scene) => simplify(scene.name) === wanted);
  if (exact) return exact;
  const words = new Set(wanted.split(" "));
  let best = null; let bestScore = 0;
  for (const scene of scenes) {
    const sceneWords = simplify(scene.name).split(" ");
    // Shared words, preferring the scene whose name has fewest extra words.
    const shared = sceneWords.filter((word) => words.has(word)).length;
    const score = shared ? shared - (sceneWords.length - shared) * 0.01 : 0;
    if (score > bestScore) { best = scene; bestScore = score; }
  }
  return best;
}

/** Functions the local model may call; each reads this project's data only. */
function chatFunctions(projectId) {
  const sceneNames = (scenes) => scenes.slice(0, 40).map((scene) => scene.name).join(", ");
  return {
    find_route: {
      description: "Find the walking route between two scenes of this tour, as the list of scenes to pass through and how each connection is walked. Set step_free to true for a route without stairs or escalators (wheelchair, pram, mobility needs).",
      params: {
        type: "object",
        properties: {
          from: { type: "string", description: "Name of the scene where the visitor starts" },
          to: { type: "string", description: "Name of the destination scene" },
          step_free: { type: "boolean", description: "true to avoid stairs and escalators" },
        },
      },
      handler: async ({ from, to, step_free: stepFree }) => {
        const avoid = stepFree ? STEP_FREE_AVOID : [];
        const { scenes, graph } = await graphFor(projectId, { avoid });
        const start = matchScene(scenes, from);
        const end = matchScene(scenes, to);
        if (!start || !end) {
          return { error: `No scene matches "${!start ? from : to}".`, scenes: sceneNames(scenes) };
        }
        if (String(start._id) === String(end._id)) return { from: start.name, to: end.name, result: "Start and destination are the same scene." };
        const route = routeBetween(scenes, graph, String(start._id), String(end._id));
        if (!route) {
          return { from: start.name, to: end.name, step_free: Boolean(stepFree),
            result: stepFree ? "No step-free route exists between these scenes." : "These scenes are not connected." };
        }
        return {
          from: start.name, to: end.name, step_free: Boolean(stepFree),
          steps: route.path.map((step, index) => (index === 0 ? `Start at ${step.name}` : `Go to ${step.name} (${step.access || "flat"})`)),
        };
      },
    },
    find_object: {
      description: "Find which scenes contain a kind of object found by the automatic object detector (for example laptop, chair, tv, person, book, printer), with how many were seen in each.",
      params: {
        type: "object",
        properties: { object: { type: "string", description: "The object to look for, in singular, e.g. laptop" } },
      },
      handler: async ({ object }) => {
        const wanted = simplify(object).replace(/(es|s)$/, "");
        if (!wanted) return { error: "Name an object to look for." };
        const scenes = await Scene.find({ projectId }).select("name detections").lean();
        const found = [];
        for (const scene of scenes) {
          const count = (scene.detections || []).filter(({ label }) => {
            const label2 = simplify(label);
            return label2 === wanted || label2.replace(/(es|s)$/, "") === wanted || label2.includes(wanted);
          }).length;
          if (count) found.push({ scene: scene.name, count });
        }
        found.sort((a, b) => b.count - a.count);
        return found.length ? { object: wanted, found } : { object: wanted, result: "Not detected in any scene." };
      },
    },
  };
}

function chatSystemPrompt(project, scenes) {
  const instructions = String(project?.assistantInstructions || "").trim();
  return [
    `You are the assistant in SmartNav360's AI Workspace${project ? ` for the project "${project.name}"` : ""}, a 360° indoor virtual tour.`,
    project?.description ? `Project description: ${String(project.description).slice(0, 500)}` : null,
    "You help with the tour: which scenes exist, how they connect, what is in them, and how to get from one place to another.",
    "",
    "Rules:",
    "- Use only the project data below and the results of your functions. If the answer is not there, say you do not know. Never invent scenes, rooms, objects, routes or directions.",
    "- For any question about getting from one scene to another, call find_route. If the visitor uses a wheelchair, has a pram, or asks to avoid stairs, set step_free to true. Give the route as numbered steps using the scene names and mention stairs, ramps, elevators or escalators on the way.",
    "- For questions about where an object is or how many there are, call find_object.",
    "- Object names come from an automatic detector with general categories, so they are approximate (a \"tv\" may be any screen). Say so when it matters.",
    "- Answer briefly and clearly, in the language the user writes in.",
    instructions ? `\nThe project owner's instructions. Follow them unless they conflict with the rules above:\n"""\n${instructions.slice(0, CHAT_MAX_INSTRUCTIONS_CHARS)}\n"""` : null,
    "",
    `Project data (${scenes.length} scene${scenes.length === 1 ? "" : "s"}; "leads to" lists each connection and how it is walked):`,
    chatContext(scenes),
  ].filter((line) => line !== null).join("\n");
}

const aiChat = async (req, res) => {
  try {
    const { message, projectId } = req.body;
    let project = null;
    if (projectId) {
      requireId(projectId, "project ID");
      project = await readableProject(projectId, req.user.id);
    }
    if (typeof message !== "string" || !message.trim()) fail(400, "Write a message first.");
    if (message.length > CHAT_MAX_MESSAGE_CHARS) fail(400, `Keep messages under ${CHAT_MAX_MESSAGE_CHARS} characters.`);
    const history = chatHistory(req.body.history);
    const scenes = projectId ? await Scene.find({ projectId }).select("name hotspots detections").lean() : [];
    const system = chatSystemPrompt(project, scenes);

    const input = { system, message: message.trim(), history, functions: projectId ? chatFunctions(projectId) : {} };
    let lastError;
    for (const name of chatProviders()) {
      try {
        const reply = await CHAT_PROVIDERS[name].reply(input);
        return res.json({ success: true, data: { reply: reply || "I could not generate a response.", model: CHAT_PROVIDERS[name].model() } });
      } catch (error) {
        lastError = error; // try the next provider, if any
      }
    }
    throw lastError;
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
    await require("../services/privacy").reviewed(project,await Scene.find({projectId:project._id}).select("image").lean());
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
    const assets=await require("../services/privacy").reviewed(project,scenes);
    const {publicImage}=require("../routes/privacyRoutes");
    if(project.floorPlan) project.floorPlan=publicImage(token,assets.get(project.floorPlan));
    delete project.assistantInstructions;
    for(const scene of scenes) {
      delete scene.objectScan;
      if(!scene.image) continue;
      const asset=assets.get(scene.image);
      scene.image=publicImage(token,asset);
      scene.thumbnailPath=publicImage(token,asset,true);
    }
    res.json({ success: true, data: { project, scenes } });
  } catch (error) { sendError(res, error); }
};

module.exports = { shortestPath, aiChat, chatProvider, chatContext, chatHistory, chatFunctions, chatSystemPrompt, CHAT_MAX_INSTRUCTIONS_CHARS, trackEvent, getAnalytics, publishProject, exportProject, getPublishedProject, ACCESS_WEIGHT };
