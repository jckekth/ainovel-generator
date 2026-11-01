---
name: testing
description: How to run, write and extend the automated tests of the AI Novel Generator (Vitest unit tests for src/lib, config contract tests for story types, Playwright E2E against the browser preview with the mock AI server). Use when adding or changing any feature, fixing a bug, adding a story type, extending the mock AI server, or verifying a phase before marking it built.
---

# Testing the AI Novel Generator

The plan and the reasons are in `docs/testing.md`. Read its section 5 before starting a new phase: it lists the tests each phase needs.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit and config tests (Vitest, jsdom). Fast; run after every change to `src/lib/` |
| `npm run test:watch` | Same, re-running on save |
| `npm run test:coverage` | Unit tests with a coverage report for `src/lib/` (keep at 90% lines or more) |
| `npm run test:e2e` | Playwright. Starts `npm run dev` (port 1420) and the mock AI server (port 8787) itself |
| `npm run test:all` | Type check and build, unit tests, then E2E. Must pass before a phase is "Built, not verified" |

On Windows, run them from PowerShell or the Bash tool; both work. If port 1420 or 8787 is in use by a dev server you started, Playwright reuses it.

E2E uses the installed Microsoft Edge (`channel: "msedge"`), so no browser download is needed. If Edge is missing, run `npx playwright install chromium` and remove the channel line in `playwright.config.ts`.

## Where tests go

- `src/lib/<module>.ts` → `src/lib/<module>.test.ts`. Import from `vitest` explicitly (`import { describe, it, expect } from "vitest"`); globals are off so `tsc` checks tests too.
- Story type JSON rules → `src/test/storyTypes.test.ts`. A new story type file is checked automatically once it is in `STORY_TYPES`; add its spec-specific rules there.
- User flows → `e2e/<area>.spec.ts`, shared steps in `e2e/helpers.ts`.

## How unit tests work here

- jsdom has no `__TAURI_INTERNALS__`, so `isTauri()` is false and `store` is the localStorage `BrowserStore`. Lib modules that read and write story files are tested **for real against localStorage**. Do not mock `storage.ts`.
- `src/test/setup.ts` clears localStorage and sessionStorage before each test. Never rely on state from another test.
- Build fixtures with the real functions (`createStory`, `saveSetting`, `saveCharacter`) rather than hand-writing files, except when testing hand-edited or corrupt files. For those, write raw text with `store.writeText`.
- For `ai.ts`, stub the network with `vi.stubGlobal("fetch", vi.fn(...))` and `vi.unstubAllGlobals()` in `afterEach`.
- Time: when an order by `updatedAt` matters, use `vi.useFakeTimers()` + `vi.setSystemTime(...)` instead of sleeping.
- Name each test after the behaviour and cite the spec or decision it protects: `it("refuses a second main character (spec 7.1)")`.

## How E2E tests work here

- Each test gets a fresh browser context, so localStorage is empty and the app behaves as a first launch. Use helpers to get to a state (`saveKey`, `createStory`, `fillSetting`, `createMainCharacter`) instead of repeating steps.
- Find elements by role and visible text (`getByRole("button", { name: "Create story" })`, `getByLabel(...)`). If an element has no accessible name, add a proper `<label>` or `aria-label` to the component rather than using CSS selectors. That also helps accessibility.
- The base URL for AI calls in E2E is `http://127.0.0.1:8787/v1`. Keys select behaviour; see the `KEYS` table in `scripts/mock-ai-server.mjs`.
- The browser preview cannot test: Windows Credential Manager, files on disk, "Open data folder", a real app restart. Leave those to the manual checks in `docs/phases/`.

## Extending the mock AI server

When a feature calls a new endpoint or needs a new failure mode:

1. Add a key to `KEYS` (or a new route) in `scripts/mock-ai-server.mjs`. Keep one behaviour per key and name it after the behaviour (`sk-test-stream-died`).
2. Keep CORS headers on every response; the browser preview needs them.
3. For streaming, send `data: {json}\n\n` chunks and finish with `data: [DONE]\n\n` (the mock sends a `finish_reason: "stop"` chunk first). A stream that closes with neither `[DONE]` nor a `finish_reason` is treated as broken off (decision 74). Add a slow variant for testing Stop.
4. Add the key to the usage text the server prints and to the table in `docs/testing.md` if it matters for manual testing.

## Workflow for a change

1. Read the spec section and the phase file. Write or update the test cases in `docs/testing.md` if the change adds behaviour.
2. Write the tests with the code. For a bug, first a failing test, then the fix.
3. Run `npm test` while working, then `npm run test:all`.
4. Report results faithfully. Name failing tests and paste the error. Never weaken an assertion just to make it pass. If the spec and the code disagree, say so and fix one of them (docs/README.md workflow).
5. Log a run that changes a phase's status in `docs/progress.md`.
