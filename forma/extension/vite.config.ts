import { defineConfig } from "vite";

// Forma side-loads the extension from a dev server URL, so the base is "./" and
// the dev server runs on a fixed port I can point the Forma manifest at.
export default defineConfig({
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", target: "es2022" },
});
