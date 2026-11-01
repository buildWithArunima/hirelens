import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev: Vite serves the UI on :5173 and forwards /api to the Express server on :3001.
export default defineConfig({
  root: "frontend",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.PORT || 3001}` },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
