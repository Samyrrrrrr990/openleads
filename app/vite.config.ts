import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The build lands inside the Python package, so the wheel ships it and
// `openleads web` serves it with no Node at runtime.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "~": here("./src") } },
  build: {
    outDir: here("../openleads/web/app"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8765", "/classic": "http://127.0.0.1:8765" },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
