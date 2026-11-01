/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// Settings follow the Tauri guide: fixed port, and no watching of the Rust side.
export default defineConfig({
  plugins: [react()],
  // The About page reads the version from the build, not from typed text (spec 10).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Unit tests (docs/testing.md). jsdom has no Tauri, so lib code uses the browser store.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
