// backend/server.js (Express)
import "dotenv/config";
import { createApp } from "./app.js";

if (!process.env.GEMINI_API_KEY && !process.env.LLM_API_KEY && !process.env.NVIDIA_API_KEY) {
  console.warn("Warning: set GEMINI_API_KEY (or NVIDIA_API_KEY / LLM_API_KEY) in .env, or model calls will fail.");
}

const PORT = process.env.PORT || 3001;
createApp().listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
