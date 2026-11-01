// backend/app.js
// Express app: JSON API under /api, plus the built React app (frontend/dist) when present.
import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAnalyzeRouter } from "./routes/analyze.js";

const DIST = fileURLToPath(new URL("../frontend/dist", import.meta.url));

export function createApp(deps = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use("/api", createAnalyzeRouter(deps));

  if (existsSync(DIST)) {
    app.use(express.static(DIST));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile("index.html", { root: DIST }));
  } else {
    // Dev mode: the UI is served by Vite, not here.
    app.get("/", (req, res) =>
      res.type("html").send('This is the API server. Open the app at <a href="http://localhost:5173">http://localhost:5173</a> (npm run dev), or run "npm run build" and restart to serve it here.'));
  }
  return app;
}
