// scripts/check-model.js
// Finds which models your API key can actually use, with a tiny request to each.
// Usage: npm run check-model            (set LLM_FIRST_CHUNK_TIMEOUT_MS to change the 60s wait)
import "dotenv/config";
process.env.LLM_FIRST_CHUNK_TIMEOUT_MS ||= "60000";
const { rankChatModels, streamCompletion } = await import("../backend/src/lib/claudeClient.js");

const ranked = await rankChatModels();
const candidates = [...new Set([process.env.LLM_MODEL, ...ranked].filter(Boolean))].slice(0, 10);
console.log(`Provider lists ${ranked.length} likely chat models. Testing ${candidates.length}:\n`);

const working = [];
for (const model of candidates) {
  const started = Date.now();
  try {
    const text = await streamCompletion({ model, system: "Be brief.", user: "Reply with just: OK", maxTokens: 400, temperature: 0 });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✅ ${model}  (${secs}s) -> ${JSON.stringify(text.trim().slice(0, 40))}`);
    working.push(model);
  } catch (err) {
    console.log(`❌ ${model}  ${err.status ? `HTTP ${err.status}` : err.message}`);
  }
}

console.log(working.length
  ? `\nPut this in .env to use the first working one:\nLLM_MODEL=${working[0]}`
  : "\nNo model answered. If every one says 404/410/timeout, the API key may not have access (check it with your provider), or the free tier is overloaded right now.");
