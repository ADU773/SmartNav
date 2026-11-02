/**
 * The AI Workspace chat through OpenAI's Chat Completions API (needs
 * OPENAI_API_KEY).
 *
 * Takes the same input as the Gemini client and the local model: a system
 * prompt, earlier turns, the new message, and functions the model may call.
 * Tool calls are run here and their results sent back, for a few rounds, so
 * route and object answers come from the project's own data.
 *
 * OPENAI_MODEL picks the model. When it is busy, rate-limited (429), failing
 * (5xx) or too slow, the fallback model answers instead.
 */

const DEFAULT_MODEL = "gpt-5.4-mini";
const FALLBACK_MODEL = "gpt-4.1-mini";
const MAX_TOOL_ROUNDS = 4;
// Reasoning models spend part of this on thinking, so it is generous.
const MAX_COMPLETION_TOKENS = 2048;
// Per request. A reply may take a few requests (tool calls), and the browser
// waits up to 120 s for the whole answer.
const TIMEOUT_MS = 25000;

function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// GPT-5 and o-series models reason before answering; "low" keeps that short.
const isReasoningModel = (model) => /^(gpt-5|o\d)/.test(model);

/** One chat completion; returns the parsed body or throws with the API's message. */
async function complete(model, request) {
    let response;
    try {
        response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: JSON.stringify({
                model,
                ...request,
                max_completion_tokens: MAX_COMPLETION_TOKENS,
                ...(isReasoningModel(model) ? { reasoning_effort: "low" } : { temperature: 0.3 }),
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        const timedOut = error.name === "TimeoutError";
        const wrapped = fail(502, timedOut ? `OpenAI (${model}) did not answer within ${TIMEOUT_MS / 1000} s.` : `OpenAI could not be reached: ${error.message}`);
        wrapped.busy = timedOut;
        throw wrapped;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = fail(response.status === 401 ? 503 : 502, `OpenAI could not answer: ${data.error?.message || `HTTP ${response.status}`}`);
        // No credits or quota left (type insufficient_quota) is not "busy":
        // the fallback model draws on the same account.
        const outOfQuota = data.error?.type === "insufficient_quota" || data.error?.code === "insufficient_quota";
        error.busy = (response.status === 429 && !outOfQuota) || response.status >= 500;
        throw error;
    }
    return data;
}

/** complete() on the configured model, then on the fallback if the first is busy. */
async function completeWithFallback(request) {
    const primary = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    try {
        return await complete(primary, request);
    } catch (error) {
        if (!error.busy || primary === FALLBACK_MODEL) throw error;
        return complete(FALLBACK_MODEL, request);
    }
}

/**
 * @param {{ system: string, message: string,
 *           history?: { role: "user" | "assistant", content: string }[],
 *           functions?: Record<string, { description: string, params?: object, handler: (params: any) => any }> }} input
 * @returns {Promise<string>}
 */
async function reply({ system, message, history = [], functions = {} }) {
    if (!process.env.OPENAI_API_KEY) throw fail(503, "The chat assistant needs OPENAI_API_KEY in backend/.env.");
    const messages = [
        { role: "system", content: system },
        ...history.map((turn) => ({ role: turn.role === "user" ? "user" : "assistant", content: turn.content })),
        { role: "user", content: message },
    ];
    const tools = Object.entries(functions).map(([name, fn]) => ({
        type: "function",
        function: { name, description: fn.description, parameters: fn.params || { type: "object", properties: {} } },
    }));

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        // On the last round tools are withheld, so the model has to answer.
        const offerTools = tools.length && round < MAX_TOOL_ROUNDS;
        const data = await completeWithFallback({ messages, ...(offerTools ? { tools } : {}) });
        const answer = data.choices?.[0]?.message;
        const calls = answer?.tool_calls || [];
        if (!calls.length) return (answer?.content || "").trim();
        messages.push(answer);
        for (const call of calls) {
            const fn = functions[call.function?.name];
            let result;
            try {
                const args = JSON.parse(call.function.arguments || "{}");
                result = fn ? await fn.handler(args) : { error: `Unknown function ${call.function?.name}.` };
            } catch (error) {
                result = { error: error.message };
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
    }
    return "";
}

module.exports = { reply, DEFAULT_MODEL, FALLBACK_MODEL };
