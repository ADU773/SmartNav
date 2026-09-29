/**
 * Background jobs for work too slow for one HTTP request: panorama analysis,
 * upscaling, inpainting, tile generation.
 *
 * A route enqueues a job and answers 202 with its ID at once; the browser
 * polls GET /api/jobs/:id for progress and the result. Handlers are plain
 * async functions registered by name with defineJob().
 *
 * This file is the in-process driver: jobs run inside the API process, a
 * fixed number at a time per job name, with a short waiting list beyond
 * which new work is turned away (503) instead of piling up. Finished jobs are
 * kept for an hour so a result can still be collected. A Redis-backed driver
 * can replace this one without changing the interface below.
 */

const crypto = require("crypto");

const RESULT_TTL_MS = 60 * 60 * 1000;
const MAX_KEPT_JOBS = 500;

const definitions = new Map(); // name -> { handler, concurrency, maxWaiting, timeoutMs }
const jobs = new Map(); // id -> job record
const lanes = new Map(); // name -> { running, waiting: [] }
const byDedupeKey = new Map(); // dedupeKey -> id of a queued or running job

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

/**
 * Registers a job type.
 * @param {string} name
 * @param {(payload: any, context: { job: object, progress: (percent: number, detail?: string) => void }) => Promise<any>} handler -
 *   returns a JSON-serialisable result; a thrown error's `message` (and `status`) is reported to the caller
 * @param {{ concurrency?: number, maxWaiting?: number, timeoutMs?: number }} [options]
 */
function defineJob(name, handler, { concurrency = 1, maxWaiting = 10, timeoutMs = 15 * 60 * 1000 } = {}) {
    definitions.set(name, { handler, concurrency, maxWaiting, timeoutMs });
    if (!lanes.has(name)) lanes.set(name, { running: 0, waiting: [] });
}

function publicView(job) {
    if (!job) return null;
    const { id, name, status, progress, detail, result, error, createdAt, startedAt, finishedAt } = job;
    return { id, name, status, progress, detail, result, error, createdAt, startedAt, finishedAt };
}

function prune() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        const finished = job.status === "done" || job.status === "failed";
        if (finished && now - job.finishedAt.getTime() > RESULT_TTL_MS) jobs.delete(id);
    }
    // Hard cap: drop the oldest finished jobs first.
    if (jobs.size > MAX_KEPT_JOBS) {
        for (const [id, job] of jobs) {
            if (jobs.size <= MAX_KEPT_JOBS) break;
            if (job.status === "done" || job.status === "failed") jobs.delete(id);
        }
    }
}

function pump(name) {
    const definition = definitions.get(name);
    const lane = lanes.get(name);
    while (lane.running < definition.concurrency && lane.waiting.length) {
        const job = lane.waiting.shift();
        lane.running += 1;
        execute(job, definition).finally(() => {
            lane.running -= 1;
            pump(name);
        });
    }
}

async function execute(job, definition) {
    job.status = "running";
    job.startedAt = new Date();
    const progress = (percent, detail) => {
        if (Number.isFinite(percent)) job.progress = Math.max(0, Math.min(100, Math.round(percent)));
        if (detail !== undefined) job.detail = String(detail).slice(0, 200);
    };
    let timer;
    try {
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(httpError(504, "The job took too long and was stopped.")), definition.timeoutMs);
            timer.unref?.();
        });
        job.result = await Promise.race([definition.handler(job.payload, { job: publicView(job), progress }), timeout]);
        job.status = "done";
        job.progress = 100;
    } catch (error) {
        job.status = "failed";
        job.error = { message: error?.message || "The job failed.", status: error?.status || 500 };
    } finally {
        clearTimeout(timer);
        job.finishedAt = new Date();
        if (job.dedupeKey && byDedupeKey.get(job.dedupeKey) === job.id) byDedupeKey.delete(job.dedupeKey);
        delete job.payload; // results are kept; inputs (often buffers) are not
    }
}

/**
 * Queues a job.
 * @param {string} name - a name registered with defineJob
 * @param {any} payload
 * @param {{ ownerId?: string, dedupeKey?: string }} [options] - `ownerId` restricts who may read the job;
 *   a second enqueue with the same `dedupeKey` while the first is queued or running returns the first
 * @returns {object} the job's public view
 */
function enqueue(name, payload, { ownerId = null, dedupeKey = null } = {}) {
    const definition = definitions.get(name);
    if (!definition) throw new Error(`Unknown job "${name}".`);
    prune();

    if (dedupeKey && byDedupeKey.has(dedupeKey)) {
        const existing = jobs.get(byDedupeKey.get(dedupeKey));
        if (existing && existing.ownerId === ownerId) return publicView(existing);
    }
    const lane = lanes.get(name);
    if (lane.waiting.length >= definition.maxWaiting) {
        throw httpError(503, "The server is busy with other work. Try again in a moment.");
    }

    const job = {
        id: crypto.randomBytes(12).toString("hex"),
        name,
        ownerId: ownerId === null ? null : String(ownerId),
        dedupeKey,
        payload,
        status: "queued",
        progress: 0,
        detail: null,
        result: null,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
    };
    jobs.set(job.id, job);
    if (dedupeKey) byDedupeKey.set(dedupeKey, job.id);
    lane.waiting.push(job);
    // Started after the caller has its reply, so a handler's synchronous
    // start-up never runs inside the request that queued it.
    queueMicrotask(() => pump(name));
    return publicView(job);
}

/**
 * A job's current state, or null when it does not exist, has expired, or
 * belongs to someone else (the two are deliberately indistinguishable).
 */
function getJob(id, ownerId = null) {
    const job = jobs.get(String(id));
    if (!job) return null;
    if (job.ownerId !== null && job.ownerId !== String(ownerId)) return null;
    return publicView(job);
}

/** Resolves when the job finishes; for tests and scripts. */
async function waitFor(id, { intervalMs = 20, timeoutMs = 60000 } = {}) {
    const started = Date.now();
    for (;;) {
        const job = jobs.get(String(id));
        if (!job) throw new Error(`Job ${id} does not exist.`);
        if (job.status === "done" || job.status === "failed") return publicView(job);
        if (Date.now() - started > timeoutMs) throw new Error(`Job ${id} did not finish in time.`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

/** Standard 202 reply for a route that started a job. */
function sendAccepted(res, job) {
    return res.status(202).json({ success: true, data: { jobId: job.id, status: job.status, statusUrl: `/api/jobs/${job.id}` } });
}

/** Clears every job and definition; tests only. */
function resetForTests() {
    jobs.clear();
    byDedupeKey.clear();
    for (const lane of lanes.values()) lane.waiting.length = 0;
}

module.exports = { defineJob, enqueue, getJob, waitFor, sendAccepted, resetForTests, driver: "memory" };
