/**
 * One place for every ONNX model the backend runs: where its weights come
 * from, how they are verified, where they are cached, which device runs
 * them, and when an idle model is unloaded again.
 *
 * Each model module calls defineModel() once at load time. That registers it,
 * so `npm run models:fetch` and GET /api/system/models can list every model
 * without a hand-maintained list.
 *
 * Weights are never committed. They are downloaded once from a pinned URL,
 * streamed to disk under a temporary name while being hashed, and only moved
 * into place when the SHA-256 matches, so a partial or altered download is
 * never used. MODEL_CACHE_DIR moves the cache (default backend/.cache/models);
 * each file can also be pointed at a local copy through its own env variable.
 *
 * GPU sessions run one at a time through a shared queue: a 4 GB laptop GPU
 * cannot hold every model's activations at once, and DirectML gains nothing
 * from overlapping runs. CPU sessions are not queued. A session left unused
 * for `idleMs` is released, so rarely used models do not pin VRAM.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { chooseDevice, forgetDevice, sessionOptions, describeDevice } = require("./onnxDevice");
const { modelCacheDir } = require("./modelCache");

const DEFAULT_IDLE_MS = 10 * 60 * 1000;
// Warnings about shape ops falling back to the CPU are expected under DirectML
// and would otherwise print on every model load.
const QUIET = { logSeverityLevel: 3 };

const registry = new Map();
let gpuQueue = Promise.resolve();

/** Runs `work` after every GPU run queued before it has finished. */
function exclusiveGpu(work) {
    const run = gpuQueue.then(work, work);
    gpuQueue = run.catch(() => {});
    return run;
}

async function sha256Of(file) {
    const hash = crypto.createHash("sha256");
    await pipeline(fs.createReadStream(file), hash);
    return hash.digest("hex");
}

/** Verified hashes, so a large file is hashed once per process, not per request. */
const verified = new Map();

async function isVerified(file, sha256) {
    if (verified.get(file) === sha256) return true;
    if (!fs.existsSync(file)) return false;
    const ok = await sha256Of(file) === sha256;
    if (ok) verified.set(file, sha256);
    return ok;
}

/** Downloads `url` to `target`, streaming and hashing; throws on a checksum mismatch. */
async function download(url, target, sha256, label) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Could not download ${label} (HTTP ${response.status}).`);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    const hash = crypto.createHash("sha256");
    try {
        const source = Readable.fromWeb(response.body);
        source.on("data", (chunk) => hash.update(chunk));
        await pipeline(source, fs.createWriteStream(temporary));
        if (hash.digest("hex") !== sha256) throw new Error(`The downloaded ${label} failed its checksum and was discarded.`);
        await fsp.rename(temporary, target);
        verified.set(target, sha256);
    } finally {
        await fsp.rm(temporary, { force: true });
    }
}

/**
 * Registers a model.
 *
 * @param {object} spec
 * @param {string} spec.id - short name, used by `models:fetch <id>` and the status API
 * @param {string} spec.label - human-readable name for messages
 * @param {string} spec.version - changes whenever the weights change; stored with results
 * @param {string} [spec.licence] - licence of the weights, shown in the status API
 * @param {Object<string, { name: string, url: string, sha256: string, envPath?: string }>} spec.files -
 *   every file the model needs, by role. `envPath` names an env variable that,
 *   when set, points at a local copy used instead (not checksummed).
 * @param {string} [spec.main] - role of the ONNX graph `session()` loads by default ("model")
 * @param {{ inputName: string, inputShape: number[], inputs?: Object<string, number[]> } | false} [spec.gpu] -
 *   a representative input for timing the model on each device (`inputs` for a
 *   graph with several inputs, by name and shape). False keeps the model on the CPU.
 * @param {number} [spec.idleMs] - release the session after this long unused
 * @param {boolean} [spec.optional] - skipped by `models:fetch` unless named, for very large downloads
 */
function defineModel(spec) {
    if (!spec?.id || !spec.files) throw new Error("defineModel needs an id and files.");
    if (registry.has(spec.id)) return registry.get(spec.id);
    const main = spec.main || "model";
    const idleMs = spec.idleMs ?? DEFAULT_IDLE_MS;
    const sessions = new Map(); // role -> { promise, device, active, timer }
    let ensuring = null;

    const pathFor = (role) => {
        const file = spec.files[role];
        if (!file) throw new Error(`${spec.label} has no file called "${role}".`);
        if (file.envPath && process.env[file.envPath]) return process.env[file.envPath];
        return path.join(modelCacheDir(), file.name);
    };

    /** Paths to every verified file, downloading whatever is missing. */
    function ensureFiles() {
        ensuring ||= (async () => {
            const paths = {};
            for (const [role, file] of Object.entries(spec.files)) {
                const target = pathFor(role);
                if (!(file.envPath && process.env[file.envPath]) && !await isVerified(target, file.sha256)) {
                    await download(file.url, target, file.sha256, `${spec.label} (${file.name})`);
                }
                paths[role] = target;
            }
            return paths;
        })().finally(() => { ensuring = null; });
        return ensuring;
    }

    /** Whether every file is already on disk (does not hash them). */
    function isCached() {
        return Object.keys(spec.files).every((role) => fs.existsSync(pathFor(role)));
    }

    const deviceSpec = (file) => spec.gpu
        ? { key: `${spec.version}|${spec.files[main].sha256.slice(0, 12)}`, file, inputName: spec.gpu.inputName, inputShape: spec.gpu.inputShape, inputs: spec.gpu.inputs }
        : null;

    /** Where the main graph runs on this machine, timing the devices on first call. */
    async function prepareDevice() {
        if (!spec.gpu) return { device: "cpu", options: {} };
        const paths = await ensureFiles();
        return chooseDevice(deviceSpec(paths[main]));
    }

    function unavailable(error) {
        const wrapped = new Error(`${spec.label} is not available: its model could not be loaded. Run \`npm run models:fetch ${spec.id}\` in the backend.`);
        wrapped.status = 503;
        wrapped.cause = error;
        return wrapped;
    }

    /**
     * The ONNX session for one file (the main graph by default), created on first
     * use. Only the main graph is timed per device; any other graph follows it.
     * @returns {Promise<{ ort: object, session: object, device: "cpu"|number }>}
     */
    function session(role = main, extraOptions = {}) {
        let entry = sessions.get(role);
        if (!entry) {
            entry = { active: 0, timer: null, device: null };
            entry.promise = (async () => {
                const ort = require("onnxruntime-node");
                const paths = await ensureFiles();
                const file = paths[role];
                let device = "cpu";
                if (spec.gpu) {
                    const mainChoice = await chooseDevice(deviceSpec(paths[main]));
                    device = mainChoice.device;
                }
                const base = { graphOptimizationLevel: "all", ...QUIET, ...extraOptions };
                try {
                    const created = await ort.InferenceSession.create(file, { ...base, ...sessionOptions(device) });
                    entry.device = device;
                    return { ort, session: created, device };
                } catch (error) {
                    if (device === "cpu") throw error;
                    // A remembered GPU that no longer loads (new driver, different
                    // machine): run on the CPU and choose again next time.
                    await forgetDevice(deviceSpec(paths[main]));
                    const created = await ort.InferenceSession.create(file, { ...base, ...sessionOptions("cpu") });
                    entry.device = "cpu";
                    return { ort, session: created, device: "cpu" };
                }
            })().catch((error) => {
                sessions.delete(role);
                throw unavailable(error);
            });
            sessions.set(role, entry);
        }
        return entry.promise;
    }

    function scheduleRelease(role, entry) {
        clearTimeout(entry.timer);
        if (!idleMs || idleMs === Infinity) return;
        entry.timer = setTimeout(async () => {
            if (entry.active > 0 || sessions.get(role) !== entry) return;
            sessions.delete(role);
            try { (await entry.promise).session.release?.(); } catch { /* already gone */ }
        }, idleMs);
        entry.timer.unref?.();
    }

    /**
     * Runs one inference. GPU runs are queued behind every other model's GPU runs.
     * @param {Object<string, object>|((ort: object) => Object<string, object>)} feeds -
     *   input tensors, or a function building them from the ort module
     * @param {{ role?: string, outputs?: string[] }} [options]
     */
    async function run(feeds, { role = main, outputs } = {}) {
        const { ort, session: loaded, device } = await session(role);
        const entry = sessions.get(role);
        if (entry) { entry.active += 1; clearTimeout(entry.timer); }
        const go = () => loaded.run(typeof feeds === "function" ? feeds(ort) : feeds, outputs);
        try {
            return await (device === "cpu" ? go() : exclusiveGpu(go));
        } finally {
            if (entry) { entry.active -= 1; scheduleRelease(role, entry); }
        }
    }

    /** "CPU" or "GPU (DirectML adapter N)" once the main graph has loaded, else null. */
    function device() {
        const entry = sessions.get(main);
        return entry?.device === null || entry?.device === undefined ? null : describeDevice(entry.device);
    }

    /** Releases every loaded session now (tests, shutdown). */
    async function release() {
        const entries = [...sessions.values()];
        sessions.clear();
        for (const entry of entries) {
            clearTimeout(entry.timer);
            try { (await entry.promise).session.release?.(); } catch { /* never loaded */ }
        }
    }

    const model = {
        id: spec.id,
        label: spec.label,
        version: spec.version,
        licence: spec.licence || null,
        optional: !!spec.optional,
        usesGpu: !!spec.gpu,
        files: spec.files,
        pathFor,
        ensureFiles,
        isCached,
        prepareDevice,
        session,
        run,
        device,
        release,
    };
    registry.set(spec.id, model);
    return model;
}

/** Every registered model, in registration order. */
function models() {
    return [...registry.values()];
}

/** Summary for the status API: what exists, whether it is downloaded, where it runs. */
function status() {
    return models().map((model) => ({
        id: model.id,
        label: model.label,
        version: model.version,
        licence: model.licence,
        cached: model.isCached(),
        usesGpu: model.usesGpu,
        device: model.device(),
        optional: model.optional,
    }));
}

module.exports = { defineModel, models, status, exclusiveGpu, sha256Of, modelCacheDir };
