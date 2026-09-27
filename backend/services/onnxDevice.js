/**
 * Chooses where an ONNX model runs: on a GPU through DirectML (Windows) when
 * that is faster, otherwise on the CPU.
 *
 * DirectML numbers a machine's graphics adapters in an order that differs
 * between machines (on a laptop, often the built-in GPU first and the faster
 * separate one second), and some adapters are slower than the CPU. So on
 * first use each candidate is timed in its own child process, and the
 * fastest is remembered per machine and model in backend/.cache/models.
 *
 * ONNX_DEVICE overrides the choice: "auto" (default), "cpu", "gpu" (DirectML
 * adapter 0) or "gpu:N" (adapter N).
 */

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const CACHE_FILE = path.join(__dirname, "..", ".cache", "models", "onnx-devices.json");
const PROBE_SCRIPT = path.join(__dirname, "onnxDeviceProbe.js");
const MAX_ADAPTERS = 4;
const PROBE_TIMEOUT_MS = 120000;
// A GPU must beat the CPU clearly to be worth the extra moving parts.
const GPU_MIN_SPEEDUP = 1.25;

function sessionOptions(device) {
    if (device === "cpu") return {};
    // DirectML supports neither memory patterns nor parallel execution.
    return { executionProviders: [{ name: "dml", deviceId: device }], enableMemPattern: false, executionMode: "sequential" };
}

/** Parses ONNX_DEVICE into "auto", "cpu" or an adapter index. */
function requestedDevice(value = process.env.ONNX_DEVICE) {
    const setting = String(value || "auto").trim().toLowerCase();
    if (setting === "cpu") return "cpu";
    if (setting === "gpu") return 0;
    const match = /^gpu:(\d+)$/.exec(setting);
    if (match) return Number(match[1]);
    return "auto";
}

function probe(spec, device) {
    return new Promise((resolve) => {
        const args = [PROBE_SCRIPT, JSON.stringify({ ...spec, device })];
        execFile(process.execPath, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
            try {
                const result = JSON.parse(stdout);
                resolve(!error && Number.isFinite(result.ms) ? result.ms : null);
            } catch {
                resolve(null); // crashed or timed out
            }
        });
    });
}

async function readCache() {
    try {
        return JSON.parse(await fsp.readFile(CACHE_FILE, "utf8"));
    } catch {
        return {};
    }
}

/**
 * The device a model should run on.
 *
 * @param {{ key: string, file: string, inputName: string, inputShape: number[] }} spec -
 *   `key` identifies the model version in the cache
 * @returns {Promise<{ device: "cpu" | number, options: object, timings?: object }>}
 */
async function chooseDevice(spec) {
    const requested = requestedDevice();
    if (requested !== "auto") return { device: requested, options: sessionOptions(requested) };
    if (process.platform !== "win32") return { device: "cpu", options: {} };

    const cacheKey = `${os.hostname()}|${spec.key}`;
    const cache = await readCache();
    if (cache[cacheKey] !== undefined) return { device: cache[cacheKey].device, options: sessionOptions(cache[cacheKey].device) };

    const timings = { cpu: await probe(spec, "cpu") };
    for (let adapter = 0; adapter < MAX_ADAPTERS; adapter += 1) timings[adapter] = await probe(spec, adapter);
    let device = "cpu";
    let best = timings.cpu ?? Infinity;
    for (let adapter = 0; adapter < MAX_ADAPTERS; adapter += 1) {
        const ms = timings[adapter];
        if (ms != null && ms * GPU_MIN_SPEEDUP < (timings.cpu ?? Infinity) && ms < best) { device = adapter; best = ms; }
    }

    cache[cacheKey] = { device, timings, measuredAt: new Date().toISOString() };
    await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fsp.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
    return { device, options: sessionOptions(device), timings };
}

/** Forgets a remembered choice, e.g. after it failed to load. */
async function forgetDevice(spec) {
    const cache = await readCache();
    delete cache[`${os.hostname()}|${spec.key}`];
    if (fs.existsSync(path.dirname(CACHE_FILE))) await fsp.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function describeDevice(device) {
    return device === "cpu" ? "CPU" : `GPU (DirectML adapter ${device})`;
}

module.exports = { chooseDevice, forgetDevice, requestedDevice, sessionOptions, describeDevice };
