/**
 * End-to-end tests against the browser preview (docs/testing.md, section 4).
 * Starts the Vite dev server and the mock AI server, or reuses them if running.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:1420",
    // The Edge that comes with Windows, so no browser download is needed.
    channel: "msedge",
    // The UI language follows the system's on first launch (spec 11); tests start in English.
    locale: "en-US",
    // Tests check behaviour, not motion: with eight browsers at once, the animations of
    // spec 12.4 slowed streaming past the timeouts. E2E-54 checks animation with motion on.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    { command: "npm run dev", url: "http://localhost:1420", reuseExistingServer: true, timeout: 60_000 },
    { command: "npm run mock-ai", port: 8787, reuseExistingServer: true },
  ],
});
