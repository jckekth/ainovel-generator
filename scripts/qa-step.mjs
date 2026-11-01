/**
 * One step of a hands-on QA session, for the qa-tester agent (.claude/agents/qa-tester.md).
 *
 * Unlike the E2E tests, the browser profile is kept between runs, so a tester can
 * act a little, look at the result, and carry on from the same state like a real user.
 *
 * Run:  node scripts/qa-step.mjs <steps.mjs> [--fresh] [--key sk-test-valid] [--profile qa1] [--name label] [--width 1280] [--height 800]
 *
 * <steps.mjs> exports `default async function (page) { ... }` with Playwright actions.
 * --fresh wipes the profile first, so the app behaves as a first launch.
 * --profile keeps a separate browser and screenshots per name, so testers can run side by side.
 * --key puts a mock AI key back before the page loads. The browser preview keeps the
 * key in sessionStorage (src/lib/secrets.ts), so without it every step starts with no key.
 * Needs `npm run dev` (port 1420) and `npm run mock-ai` (port 8787) running.
 *
 * Prints the URL, an accessibility snapshot of the page, console errors and failed
 * requests, and saves a full-page screenshot under test-results/qa/shots/.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = "http://localhost:1420";
const ROOT = resolve("test-results/qa");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const PROFILE_NAME = flag("profile", "default");
const PROFILE = resolve(ROOT, "profile", PROFILE_NAME);
const SHOTS = resolve(ROOT, "shots", PROFILE_NAME);
const VALUE_FLAGS = ["--name", "--width", "--height", "--key", "--profile"];
const stepsFile = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1]));

if (!stepsFile) {
  console.error("Usage: node scripts/qa-step.mjs <steps.mjs> [--fresh] [--key sk-test-valid] [--profile qa1] [--name label] [--width 1280] [--height 800]");
  process.exit(2);
}

for (const [url, start] of [[APP, "npm run dev"], ["http://127.0.0.1:8787/v1/models", "npm run mock-ai"]]) {
  try {
    await fetch(url);
  } catch {
    console.error(`Nothing answers at ${url}. Start it with "${start}" and run this step again.`);
    process.exit(2);
  }
}

if (args.includes("--fresh")) rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const width = Number(flag("width", 1280));
const height = Number(flag("height", 800));
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "msedge",
  headless: true,
  viewport: { width, height },
});
const key = flag("key");
if (key) await context.addInitScript((k) => sessionStorage.setItem("ang-dev-api-key", k), key);
const page = context.pages()[0] ?? (await context.newPage());

const problems = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(`console.${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`));
page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`));

await page.goto(APP);
await page.waitForLoadState("networkidle").catch(() => {});

let failed = null;
try {
  const steps = await import(pathToFileURL(resolve(stepsFile)).href);
  await steps.default(page);
} catch (e) {
  failed = e;
}

// Numbered so the shots read in order in the report.
const n = String(readdirSync(SHOTS).filter((f) => f.endsWith(".png")).length + 1).padStart(3, "0");
const shot = resolve(SHOTS, `${n}-${flag("name", "step")}.png`);
await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

console.log(`URL: ${page.url()}`);
console.log(`Viewport: ${width}x${height}`);
console.log(`Screenshot: ${shot}`);
console.log("\n--- Page (accessibility snapshot) ---");
console.log(await page.locator("body").ariaSnapshot().catch((e) => `(could not read: ${e.message})`));
console.log("\n--- Problems seen during this step ---");
console.log(problems.length ? problems.join("\n") : "none");
if (failed) {
  console.log("\n--- The step stopped with an error ---");
  console.log(failed.stack ?? String(failed));
}

await context.close();
process.exit(failed ? 1 : 0);
