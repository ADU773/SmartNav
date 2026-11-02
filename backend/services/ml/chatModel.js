/**
 * The language model behind the AI Workspace chat, run inside this process
 * with llama.cpp (node-llama-cpp), so the assistant needs no API key and no
 * separate server.
 *
 * The weights (2.5 GB, 4-bit GGUF) are not committed. They are downloaded once
 * from a pinned Hugging Face revision, verified against a SHA-256 and cached
 * like every other model (see modelStore.js). Set CHAT_MODEL_PATH to use a
 * GGUF file you provide instead.
 *
 * llama.cpp chooses its own backend (CUDA, Vulkan or the CPU) and how many
 * layers fit on the GPU; it does not go through ONNX Runtime or the DirectML
 * device selection. Replies are generated one at a time. The model is unloaded
 * after a period without use, unless CHAT_PRELOAD=true keeps it loaded.
 *
 * The model can call functions the caller supplies (route finding, object
 * lookup), so answers about the project come from the project's own data
 * rather than from the model's guess.
 *
 * Model: Qwen3-4B-Instruct-2507 (Qwen team, 2025), Apache-2.0, the
 * non-thinking instruction-tuned release. No official GGUF exists, so this is
 * the Q4_K_M quantisation published at
 * huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF, pinned by revision and
 * checksum.
 */

const { defineModel } = require("../modelStore");

const MODEL_VERSION = "qwen3-4b-instruct-2507-q4_k_m@a06e946";
const IDLE_MS = 10 * 60 * 1000;
const CONTEXT_SIZE = 8192;
const MAX_REPLY_TOKENS = 768;
// Qwen's recommended sampling for the instruct model, made a little more
// conservative because answers must stick to the project data.
const SAMPLING = { temperature: 0.4, topP: 0.8, topK: 20 };

const model = defineModel({
    id: "chat",
    label: "Chat assistant (Qwen3-4B-Instruct)",
    version: MODEL_VERSION,
    licence: "Apache-2.0",
    files: {
        model: {
            name: "qwen3-4b-instruct-2507-q4_k_m.gguf",
            url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
            sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
            envPath: "CHAT_MODEL_PATH",
        },
    },
    // Not an ONNX graph: llama.cpp picks its own device.
    gpu: false,
    // 2.5 GB and only used with LLM_PROVIDER=local: `models:fetch chat` gets it.
    optional: true,
});

let loading = null; // Promise<{ llama, model }>
let ready = false; // `loading` has resolved
let idleTimer = null;
let queue = Promise.resolve();
let testReply = null;

function unavailable(error) {
    const wrapped = new Error(`The chat assistant is not available: its model could not be loaded. Run \`npm run models:fetch chat\` in the backend.`);
    wrapped.status = 503;
    wrapped.cause = error;
    return wrapped;
}

function stillDownloading() {
    const error = new Error("The chat model is still downloading (2.5 GB, once). Try again in a few minutes, or run `npm run models:fetch chat` in the backend.");
    error.status = 503;
    return error;
}

/**
 * Loads the weights on first use; a failure is not cached. A missing file is
 * never downloaded inside a chat request (the browser would time out long
 * before 2.5 GB arrives): the download starts in the background and the
 * request is told to retry.
 */
function load() {
    if (!loading && !model.isCached()) {
        if (process.env.CHAT_MODEL_PATH) {
            const error = new Error(`CHAT_MODEL_PATH points at ${process.env.CHAT_MODEL_PATH}, which does not exist.`);
            error.status = 503;
            return Promise.reject(error);
        }
        model.ensureFiles().catch(() => {}); // shared and deduplicated by the model store
        return Promise.reject(stillDownloading());
    }
    if (!loading) {
        const attempt = (async () => {
            const { getLlama } = await import("node-llama-cpp");
            const paths = await model.ensureFiles();
            const llama = await getLlama();
            const loaded = await llama.loadModel({ modelPath: paths.model });
            return { llama, model: loaded };
        })().catch((error) => {
            loading = null;
            throw unavailable(error);
        });
        attempt.then(() => { if (loading === attempt) ready = true; }, () => {});
        loading = attempt;
    }
    return loading;
}

// CHAT_PRELOAD=true (the demo launcher sets it) keeps the model loaded.
const keepLoaded = () => process.env.CHAT_PRELOAD === "true";

function scheduleUnload() {
    clearTimeout(idleTimer);
    if (keepLoaded()) return;
    idleTimer = setTimeout(() => { release().catch(() => {}); }, IDLE_MS);
    idleTimer.unref?.();
}

/**
 * Answers one message. Each call starts from the given system prompt and the
 * history the caller passes, so one user's chat never leaks into another's.
 *
 * `functions` maps a name to { description, params (JSON schema), handler };
 * the model may call them before answering, and their results are fed back to
 * it. Handlers run in this process and should only read data.
 *
 * @param {{ system: string, message: string,
 *           history?: { role: "user" | "assistant", content: string }[],
 *           functions?: Record<string, { description: string, params?: object, handler: (params: any) => any }> }} input
 * @returns {Promise<string>}
 */
function reply({ system, message, history = [], functions = {} }) {
    if (testReply) return Promise.resolve(testReply({ system, message, history, functions }));
    const run = queue.then(async () => {
        clearTimeout(idleTimer);
        const { model: loaded } = await load();
        const { LlamaChatSession, defineChatSessionFunction } = await import("node-llama-cpp");
        const context = await loaded.createContext({ contextSize: CONTEXT_SIZE });
        try {
            const session = new LlamaChatSession({ contextSequence: context.getSequence() });
            session.setChatHistory([
                { type: "system", text: system },
                ...history.map((turn) => (turn.role === "user"
                    ? { type: "user", text: turn.content }
                    : { type: "model", response: [turn.content] })),
            ]);
            const sessionFunctions = Object.fromEntries(Object.entries(functions).map(([name, fn]) => [name,
                defineChatSessionFunction({ description: fn.description, params: fn.params, handler: fn.handler })]));
            const text = await session.prompt(message, {
                maxTokens: MAX_REPLY_TOKENS,
                ...SAMPLING,
                ...(Object.keys(sessionFunctions).length ? { functions: sessionFunctions } : {}),
            });
            return text.trim();
        } finally {
            await context.dispose();
            scheduleUnload();
        }
    });
    queue = run.catch(() => {});
    return run;
}

/**
 * Loads the model ahead of the first question, so it does not wait ~15 s.
 * Resolves false instead of throwing when the weights are missing or fail to
 * load; the chat then reports that itself.
 */
function preload() {
    return load().then(() => true, () => false);
}

/** "loaded", "loading" or "not loaded", for the health check. */
function status() {
    if (ready) return "loaded";
    return loading ? "loading" : "not loaded";
}

/** Unloads the model now (idle timeout, tests, shutdown). */
async function release() {
    clearTimeout(idleTimer);
    const current = loading;
    loading = null;
    ready = false;
    if (!current) return;
    try {
        const { llama, model: loaded } = await current;
        await loaded.dispose();
        await llama.dispose();
    } catch { /* never loaded */ }
}

/** Tests: answer with `fn` instead of the model (null restores it). */
function setTestReply(fn) {
    testReply = fn;
}

module.exports = { reply, preload, status, release, setTestReply, modelVersion: () => MODEL_VERSION, CONTEXT_SIZE, MAX_REPLY_TOKENS };
