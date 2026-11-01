// backend/src/lib/claudeClient.js
// Thin JSON-returning chat client over any OpenAI-compatible endpoint.
// Pick a provider by which key is set in .env:
//   GEMINI_API_KEY  -> Google Gemini (default model gemini-flash-latest)
//   NVIDIA_API_KEY  -> NVIDIA
//   LLM_API_KEY     -> any other OpenAI-compatible provider (set LLM_BASE_URL too)
// LLM_BASE_URL and LLM_MODEL override the provider's defaults.

import OpenAI from "openai";

const PROVIDERS = {
  gemini: { keyVar: "GEMINI_API_KEY", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-flash-latest", jsonMode: true },
  nvidia: { keyVar: "NVIDIA_API_KEY", baseURL: "https://integrate.api.nvidia.com/v1", model: "deepseek-ai/deepseek-v4.1-flash" },
};

function provider() {
  if (process.env.LLM_API_KEY) return { key: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL || PROVIDERS.nvidia.baseURL, model: null };
  for (const p of Object.values(PROVIDERS)) {
    if (process.env[p.keyVar]) return { key: process.env[p.keyVar], baseURL: process.env.LLM_BASE_URL || p.baseURL, model: p.model, jsonMode: p.jsonMode };
  }
  throw new Error("Set GEMINI_API_KEY (or NVIDIA_API_KEY / LLM_API_KEY) in .env to call the model");
}

let client;
function getClient() {
  if (!client) {
    const { key, baseURL } = provider();
    client = new OpenAI({ apiKey: key, baseURL });
  }
  return client;
}

// Provider catalogs change (models get retired), so when the configured model
// is gone (404/410) we pick a replacement from the provider's own model list.
const PREFERRED = [/gemini-[\d.]+-flash$/i, /gemini-[\d.]+-pro$/i, /gemini.*flash/i, /deepseek-v\d/i, /glm-?\d/i, /qwen3.*(instruct|coder)|qwen3-\d+b/i, /kimi-k\d/i, /gpt-oss-120b/i, /llama-3\.3-70b-instruct/i, /llama.*70b.*instruct/i];
const NOT_CHAT = /embed|rerank|guard|safety|reward|vision|vlm|parse|clip|retriev|whisper|tts|asr|nemoretriever|-vl\b|ocr|detector|translate|cosmos|flux|stable-diffusion|imagen|veo|image|audio|live|lite/i;
let activeModel = null;
let modelListPromise = null;

async function listChatModels() {
  modelListPromise ||= getClient().models.list()
    .then(page => page.data.map(m => m.id.replace(/^models\//, "")).filter(id => !NOT_CHAT.test(id)))
    .catch(() => []);
  return modelListPromise;
}

// Chat models from the provider's list, best guess first.
export async function rankChatModels() {
  const ids = await listChatModels();
  const ranked = [];
  for (const re of PREFERRED) {
    ranked.push(...ids.filter(id => re.test(id) && !ranked.includes(id)).sort().reverse()); // newest-looking version first
  }
  return ranked;
}

async function pickFallback(tried) {
  return (await rankChatModels()).find(id => !tried.includes(id)) || null;
}

// Some models think silently for a minute or two before the first chunk, so the
// wait for the first chunk is longer than the allowed gap once streaming starts.
const FIRST_CHUNK_TIMEOUT_MS = Number(process.env.LLM_FIRST_CHUNK_TIMEOUT_MS) || 180_000;
const IDLE_TIMEOUT_MS = Number(process.env.LLM_IDLE_TIMEOUT_MS) || 60_000;

// Streams one completion. Aborts if the first chunk takes longer than
// FIRST_CHUNK_TIMEOUT_MS or the stream then goes quiet for IDLE_TIMEOUT_MS,
// and logs progress so a long run doesn't look frozen.
export async function streamCompletion({ model, system, user, maxTokens, temperature, json = false }) {
  const controller = new AbortController();
  let idle, waitMs = FIRST_CHUNK_TIMEOUT_MS;
  const resetIdle = (ms = IDLE_TIMEOUT_MS) => {
    clearTimeout(idle);
    waitMs = ms;
    idle = setTimeout(() => controller.abort(), ms);
  };
  let text = "", thinking = 0;
  const started = Date.now();
  const progress = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`[${model}] ${secs}s: ${thinking ? `${thinking} chars of thinking, ` : ""}${text.length} chars of answer`);
  }, 20_000);
  try {
    resetIdle(FIRST_CHUNK_TIMEOUT_MS);
    const stream = await getClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true,
      ...(json && provider().jsonMode && { response_format: { type: "json_object" } }),
    }, { signal: controller.signal });
    for await (const chunk of stream) {
      resetIdle();
      const delta = chunk.choices[0]?.delta || {};
      thinking += (delta.reasoning_content || delta.reasoning || "").length;
      text += delta.content || "";
    }
    return text;
  } catch (err) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error(`no response for ${waitMs / 1000}s`), { stalled: true });
    }
    throw err;
  } finally {
    clearTimeout(idle);
    clearInterval(progress);
  }
}

const TRANSIENT_STATUS = new Set([500, 502, 503]);
const RETRY_DELAYS_MS = [5_000, 15_000];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs `attempt`, waiting and trying again when the provider reports a passing server error.
export async function retryTransient(attempt, { delays = RETRY_DELAYS_MS, wait = sleep, label = "model" } = {}) {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (err) {
      if (!TRANSIENT_STATUS.has(err.status) || tries >= delays.length) throw err;
      console.warn(`${label} returned ${err.status}; retrying in ${delays[tries] / 1000}s (retry ${tries + 1} of ${delays.length})`);
      await wait(delays[tries]);
    }
  }
}

// Returns the model's raw text.
export async function chat({ system, user, maxTokens = 8192, temperature = 0.2, json = false }) {
  const tried = [];
  let model = activeModel || process.env.LLM_MODEL || provider().model || (await pickFallback([]));
  if (!model) throw new Error("Set LLM_MODEL in .env");
  for (;;) {
    tried.push(model);
    try {
      const text = await retryTransient(() => streamCompletion({ model, system, user, maxTokens, temperature, json }), { label: model });
      if (activeModel !== model) console.log(`Using model ${model}`);
      activeModel = model;
      // Reasoning models may put their thinking inline; keep only the answer.
      return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    } catch (err) {
      // Free endpoints often queue a request forever; a stalled model is as good as gone.
      const gone = err.status === 404 || err.status === 410 || err.status === 429 || TRANSIENT_STATUS.has(err.status) || err.stalled;
      const next = gone && tried.length < 5 ? await pickFallback(tried) : null;
      if (next) {
        console.warn(`Model ${model} unavailable (${err.status || err.message}); trying ${next}`);
        model = next;
        continue;
      }
      // Say which endpoint and models failed: a bare "404 page not found" is otherwise a mystery.
      const hint = err.status === 429 ? " The provider's rate limit or daily quota is used up: wait, or use a key with more quota."
        : gone ? " The model may be retired: set LLM_MODEL in .env to a model listed for your key (and check LLM_BASE_URL ends in /v1)."
        : err.status === 401 || err.status === 403 ? " Check the API key in .env." : "";
      throw new Error(`Model call failed (${tried.join(", ")} at ${getClient().baseURL}): ${String(err.message).replace(/\.$/, "")}.${hint}`);
    }
  }
}

// Pull the first JSON object/array out of a model reply (tolerates ``` fences
// and stray prose around it).
export function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start === -1 || end <= start) throw new Error("Model reply contained no JSON");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

// Ask for JSON; if the reply doesn't parse, ask the model once to repair it.
export async function chatJson({ system, user, maxTokens, llm = chat }) {
  const first = await llm({ system, user, maxTokens, json: true });
  try {
    return extractJson(first);
  } catch (err) {
    const repaired = await llm({
      system: "You fix malformed JSON. Return only the corrected JSON, nothing else.",
      user: `This should be valid JSON but failed to parse (${err.message}). Fix it without changing its content:\n\n${first}`,
      maxTokens,
      json: true,
    });
    return extractJson(repaired);
  }
}
