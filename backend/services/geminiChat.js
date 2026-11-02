/**
 * The AI Workspace chat through Google's Gemini API (needs GEMINI_API_KEY).
 *
 * Takes the same input as the local model (services/ml/chatModel.js): a system
 * prompt, earlier turns, the new message, and functions the model may call.
 * Function calls are run here and their results sent back, for a few rounds,
 * so route and object answers come from the project's own data.
 *
 * GEMINI_MODEL picks the model. When it is busy ("high demand", HTTP 503),
 * rate-limited (429) or too slow, the fallback model answers instead.
 */

const DEFAULT_MODEL = "gemini-3.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash";
const MAX_FUNCTION_ROUNDS = 4;
const MAX_REPLY_TOKENS = 1024;
// Per request. A reply may take a few requests (function calls), and the
// browser waits up to 120 s for the whole answer.
const TIMEOUT_MS = 25000;

function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

/** One generateContent call; returns the parsed body or throws with the API's message. */
async function generate(model, body) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        const timedOut = error.name === "TimeoutError";
        const wrapped = fail(502, timedOut ? `Gemini (${model}) did not answer within ${TIMEOUT_MS / 1000} s.` : `Gemini could not be reached: ${error.message}`);
        // An overloaded model often answers slowly instead of with a 503.
        wrapped.busy = timedOut;
        throw wrapped;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = fail(502, `Gemini could not answer: ${data.error?.message || `HTTP ${response.status}`}`);
        error.busy = response.status === 503 || response.status === 429;
        throw error;
    }
    return data;
}

/** generate() on the configured model, then on the fallback if the first is busy. */
async function generateWithFallback(body) {
    const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    try {
        return await generate(primary, body);
    } catch (error) {
        if (!error.busy || primary === FALLBACK_MODEL) throw error;
        return generate(FALLBACK_MODEL, body);
    }
}

/**
 * @param {{ system: string, message: string,
 *           history?: { role: "user" | "assistant", content: string }[],
 *           functions?: Record<string, { description: string, params?: object, handler: (params: any) => any }> }} input
 * @returns {Promise<string>}
 */
async function reply({ system, message, history = [], functions = {} }) {
    if (!process.env.GEMINI_API_KEY) throw fail(503, "The chat assistant needs GEMINI_API_KEY in backend/.env.");
    const contents = [...history, { role: "user", content: message }]
        .map((turn) => ({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.content }] }));
    const declarations = Object.entries(functions)
        .map(([name, fn]) => ({ name, description: fn.description, parameters: fn.params }));
    const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: MAX_REPLY_TOKENS },
        ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
    };

    for (let round = 0; round <= MAX_FUNCTION_ROUNDS; round += 1) {
        const data = await generateWithFallback(body);
        const content = data.candidates?.[0]?.content;
        const parts = content?.parts || [];
        const calls = parts.filter((part) => part.functionCall);
        if (!calls.length || round === MAX_FUNCTION_ROUNDS) {
            return parts.map((part) => part.text || "").join("").trim();
        }
        // Send the model's turn back unchanged (it carries Gemini's thought
        // signatures), followed by each function's result.
        contents.push(content);
        const results = [];
        for (const { functionCall } of calls) {
            const fn = functions[functionCall.name];
            let result;
            try {
                result = fn ? await fn.handler(functionCall.args || {}) : { error: `Unknown function ${functionCall.name}.` };
            } catch (error) {
                result = { error: error.message };
            }
            results.push({ functionResponse: { name: functionCall.name, response: { result } } });
        }
        contents.push({ role: "user", parts: results });
    }
    return "";
}

module.exports = { reply, DEFAULT_MODEL, FALLBACK_MODEL };
