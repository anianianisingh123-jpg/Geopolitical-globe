import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { intelPlugin } from "./server/intel";

const stub = fileURLToPath(new URL("./src/globe/stubs/unused-layer.ts", import.meta.url));

// GitHub Pages serves this repo at /Geopolitical-globe/. Local/dev stays at /.
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  // intelPlugin: local news/trends/fires endpoints under `vite` and `vite preview` (see server/intel.ts).
  plugins: [react(), intelPlugin()],
  resolve: {
    // three-globe statically imports the WebGPU renderer (heatmap layer) and
    // h3-js (hexbin layers). Neither layer is used, so both resolve to a stub
    // that throws if called. See src/globe/stubs/unused-layer.ts.
    alias: [
      { find: /^three\/webgpu$/, replacement: stub },
      { find: /^three\/tsl$/, replacement: stub },
      { find: /^h3-js$/, replacement: stub },
    ],
  },
  server: {
    // Build output and caches churn during work; keep them away from the watcher.
    watch: { ignored: ["**/dist/**", "**/node_modules/**", "**/.git/**", "**/public/geo/**"] },
  },
  build: {
    target: "es2022",
    // The lazily-loaded globe chunk carries three.js; the entry chunk stays small.
    chunkSizeWarningLimit: 1100,
  },
});
