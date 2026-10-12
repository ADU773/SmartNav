/**
 * The language model behind the AI Workspace chat, run inside this process
 * with llama.cpp (node-llama-cpp), so the assistant needs no API key and no
 * separate server.
 *
 * The weights (1.1 GB, 4-bit GGUF) are not committed. They are downloaded once
 * from a pinned Hugging Face revision, verified against a SHA-256 and cached
 * like every other model (see modelStore.js). Set CHAT_MODEL_PATH to use a
 * GGUF file you provide instead.
 *
 * llama.cpp chooses its own backend (CUDA, Vulkan or the CPU); it does not go
 * through ONNX Runtime or the DirectML device selection. Replies are generated
 * one at a time, and the model is unloaded after a period without use so it
 * does not hold memory between conversations.
 *
 * Model: Qwen2.5-1.5B-Instruct (Qwen team, 2024), Apache-2.0, official GGUF
 * export at huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF.
 */

const { defineModel } = require("../modelStore");

const MODEL_VERSION = "qwen2.5-1.5b-instruct-q4_k_m@91cad51";
const IDLE_MS = 10 * 60 * 1000;
const CONTEXT_SIZE = 4096;
const MAX_REPLY_TOKENS = 512;

const model = defineModel({
    id: "chat",
    label: "Chat assistant (Qwen2.5-1.5B-Instruct)",
    version: MODEL_VERSION,
    licence: "Apache-2.0",
    files: {
        model: {
            name: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
            envPath: "CHAT_MODEL_PATH",
        },
    },
    // Not an ONNX graph: llama.cpp picks its own device.
    gpu: false,
});

let loading = null; // Promise<{ llama, model }>
let idleTimer = null;
let queue = Promise.resolve();
let testReply = null;

function unavailable(error) {
    const wrapped = new Error(`The chat assistant is not available: its model could not be loaded. Run \`npm run models:fetch chat\` in the backend.`);
    wrapped.status = 503;
    wrapped.cause = error;
    return wrapped;
}

/** Loads the weights on first use; a failure is not cached. */
function load() {
    loading ||= (async () => {
        const { getLlama } = await import("node-llama-cpp");
        const paths = await model.ensureFiles();
        const llama = await getLlama();
        const loaded = await llama.loadModel({ modelPath: paths.model });
        return { llama, model: loaded };
    })().catch((error) => {
        loading = null;
        throw unavailable(error);
    });
    return loading;
}

function scheduleUnload() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { release().catch(() => {}); }, IDLE_MS);
    idleTimer.unref?.();
}

/**
 * Answers one message. Each call starts a fresh conversation with the given
 * system prompt, so one user's chat never leaks into another's.
 * @param {{ system: string, message: string }} input
 * @returns {Promise<string>}
 */
function reply({ system, message }) {
    if (testReply) return Promise.resolve(testReply({ system, message }));
    const run = queue.then(async () => {
        clearTimeout(idleTimer);
        const { model: loaded } = await load();
        const { LlamaChatSession } = await import("node-llama-cpp");
        const context = await loaded.createContext({ contextSize: CONTEXT_SIZE });
        try {
            const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: system });
            const text = await session.prompt(message, { maxTokens: MAX_REPLY_TOKENS, temperature: 0.3 });
            return text.trim();
        } finally {
            await context.dispose();
            scheduleUnload();
        }
    });
    queue = run.catch(() => {});
    return run;
}

/** Unloads the model now (idle timeout, tests, shutdown). */
async function release() {
    clearTimeout(idleTimer);
    const current = loading;
    loading = null;
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

module.exports = { reply, release, setTestReply, modelVersion: () => MODEL_VERSION };
