# Testing internals

Last checked against the code: 2026-11-01

How the test layers are wired. What to test and the case lists are in [testing.md](../testing.md); the how-to is the `testing` skill ([.claude/skills/testing/SKILL.md](../../.claude/skills/testing/SKILL.md)). This page covers the machinery: config, fixtures, the mock AI server and the QA script.

## Commands

From [package.json](../../package.json):

| Script | Runs |
| --- | --- |
| `npm test` | `vitest run` |
| `npm run test:coverage` | `vitest run --coverage` (v8, `src/lib/**/*.ts` only) |
| `npm run test:e2e` | `playwright test` |
| `npm run test:all` | `npm run build` (`tsc --noEmit` and `vite build`), then `npm test`, then `npm run test:e2e` |
| `npm run mock-ai` | `node scripts/mock-ai-server.mjs` |

## Unit and config tests (Vitest)

Configured in the `test` block of [vite.config.ts](../../vite.config.ts): `environment: "jsdom"`, `include: ["src/**/*.test.ts"]`, `setupFiles: ["src/test/setup.ts"]`. Globals are off; tests import from `vitest`.

- **No Tauri.** jsdom has no `__TAURI_INTERNALS__`, so `isTauri()` is false: `store` is the localStorage `BrowserStore`, the key lives in sessionStorage, and `ai.ts` uses the global `fetch`. File logic runs for real; nothing in `storage.ts` is mocked.
- **Clean state.** [src/test/setup.ts](../../src/test/setup.ts) clears localStorage and sessionStorage before every test.
- **`import.meta.env.DEV` is true**, so the AI call log is on and its files land in localStorage; [devlog.test.ts](../../src/lib/devlog.test.ts) and [novel.test.ts](../../src/lib/novel.test.ts) read them back.
- **No Web Audio.** jsdom has no `AudioContext`, so the music player does nothing; [music.test.ts](../../src/lib/music.test.ts) tests its pure parts (`musicStep`, `dbToGain`, track files and credits), and E2E-57 to E2E-59 test the player in Edge.
- **Module tests sit next to the module** (`src/lib/<module>.test.ts`). The config contract tests are in [src/test/storyTypes.test.ts](../../src/test/storyTypes.test.ts) ([story-types.md](story-types.md#the-contract-tests)).

### Fixtures

[src/test/fixtures.ts](../../src/test/fixtures.ts):

| Export | Does |
| --- | --- |
| `readyStory(setting?, type?)` | Creates a story with the real functions: setting from the defaults (plus overrides), the example main character, key `sk-test`, base URL `https://api.example.com/v1`, model `gpt-test` |
| `callKind(messages)` | `"end-chapter"` if the system message starts with `You are the editor`, `"epilogue"` if it contains `Write the epilogue`, else `"block"` |
| `stubAi(answer)` | Replaces global `fetch` with a `vi.fn` that streams the answer for each call kind in 7-character SSE chunks plus `[DONE]`; a number answer becomes that HTTP status; an aborted signal throws `AbortError` |
| `stubDefaultAi()` | `stubAi` with `BLOCK`, `END_CHAPTER` (as JSON) and a one-line epilogue |
| `sentMessages(fetch, n)` | The messages of the nth call, to assert on the prompt |
| `BLOCK`, `END_CHAPTER` | A well-formed block and End Chapter answer |

Tests that stub `fetch` call `vi.unstubAllGlobals()` afterwards (the skill's rule).

## End-to-end tests (Playwright)

[playwright.config.ts](../../playwright.config.ts):

- `testDir: "e2e"`, `fullyParallel: true`, base URL `http://localhost:1420`, `channel: "msedge"` (the installed Edge, decision 34), traces and screenshots kept on failure, HTML report not opened.
- `webServer` starts `npm run dev` (waits for the URL, 60 s) and `npm run mock-ai` (waits for port 8787), and reuses either if already running.
- `locale: "en-US"`, so the UI starts in English whatever the machine's language (spec 11), and `reducedMotion: "reduce"`, so the animations of spec 12.4 do not slow eight parallel browsers past the timeouts. E2E-54 turns motion back on to test the animation.
- Each test gets a fresh browser context: empty localStorage and sessionStorage, so the app starts as a first launch.

[e2e/helpers.ts](../../e2e/helpers.ts) holds the shared steps: `MOCK_AI` (the mock's base URL), `panel` (the visible `tabpanel`), `saveKey`, `useMockAi`, `setUpMockAi`, `createStory`, `openTab`, `saveSetting`, `startCharacter`, `createMainCharacter`, `readyStory`, `switchKey`, `chapterText`, `blocks`, `waitForBlock`.

Specs by area: [settings.spec.ts](../../e2e/settings.spec.ts), [stories.spec.ts](../../e2e/stories.spec.ts), [novel.spec.ts](../../e2e/novel.spec.ts), [chapters.spec.ts](../../e2e/chapters.spec.ts), [polish.spec.ts](../../e2e/polish.spec.ts), [fixes.spec.ts](../../e2e/fixes.spec.ts), [ux.spec.ts](../../e2e/ux.spec.ts) (phase 6), [look.spec.ts](../../e2e/look.spec.ts) (phase 7), [general.spec.ts](../../e2e/general.spec.ts) (phase 7b), [music.spec.ts](../../e2e/music.spec.ts) and [pictures.spec.ts](../../e2e/pictures.spec.ts) (phase 8). Test titles start with their E2E id from [testing.md](../testing.md) section 4.

**Always scope to `panel(page)`.** The story workspace keeps all three tabs mounted ([architecture.md](architecture.md#the-story-workspace)), so an unscoped locator can match a hidden tab.

**Music and pictures in E2E.** The player mirrors its state on `<html data-music>`, and each picture place carries `data-picture` (`drawing`, `shown`, `failed` or `make`), so tests wait on attributes, not on sound or pixels.

**Reading the prompt a test sent.** Use a key with a tag, `sk-test-valid~<testId>`, then `GET <MOCK_AI>/_last-request` with the same key returns that test's last chat request body. Tests run in parallel, so the tag keeps their requests apart (see `E2E-09` in [novel.spec.ts](../../e2e/novel.spec.ts)).

## The mock AI server

[scripts/mock-ai-server.mjs](../../scripts/mock-ai-server.mjs) is a plain Node `http` server on `127.0.0.1:8787` (or `PORT`).

| Route | Answer |
| --- | --- |
| `OPTIONS *` | 204 with CORS headers |
| `GET /v1/models` | The key's `models` list, its error status, or `raw` text; `sk-test-slow` waits 5 s first |
| `POST /v1/chat/completions` | An SSE stream per the key's `chat` behaviour, or its error status |
| `GET /v1/_last-request` | The last chat body sent with this exact key (tag included), or 404 |
| `POST /v1/images/generations` | A small PNG as `b64_json`, a different colour each time; or the key's `image` behaviour: `refused` (400 `moderation_blocked`), `slow` (about 3 s), `error` (500) |
| `GET /v1/_last-image-request` | The last image request body sent with this exact key, or 404 |
| anything else | 404 |

**Keys.** `KEYS` maps a key (the part before `~`) to `status`, `models`, `raw`, `delayMs`, `code`, `message`, `chat`, and optionally `noUsage` (no usage chunk), `rejectsUsage` (400 for `stream_options`) and `image`. `MODELS` includes `mock-image-1` for the picture tests. Any other key gets 401. Error answers look like OpenAI's: `{ error: { message, code? } }`. `CHAT_HELP` and the start-up printout describe each `chat` behaviour. The table of keys for manual testing is in [testing.md](../testing.md) section 4.

**Which call it is.** `requestKind` reads the system message: `You are the editor…` is End Chapter, one containing `Write the epilogue` is the epilogue, anything else a block. Every key that writes blocks also answers these two.

**What it writes:**

- `blockText`: a numbered block (a module-level `blockCount`, so each version differs) that echoes the `Direction: ` and `Hint for this version: ` lines of the prompt, then `=== NEXT ===`, three actions, the flag, a mood line (a mood named as a word in the direction or hint, else `none`) and, when the system message contains `Then the picture line`, a `PICTURE:` line naming the main character. `died` adds a death and `yes`; `malformed` leaves out the marker and ends with a bare flag line; `long` adds about 800 words of filler and streams 20 pieces at a time.
- `endChapterText`: a fixed JSON answer in a code fence, built from the request: the chapter number from the system message, the main character's name from the `### <name> (main character)` heading, and the used scenes it was sent plus one. It holds one valid change, one change for an unknown character (to be dropped), the new character "Elder Wu" (without an age for `sk-test-new-character-no-age`) and two openings.
- `epilogueText`: a short epilogue echoing the direction.
- Behaviours: `slow` waits 150 ms between pieces (8 ms otherwise); `error` destroys the socket halfway; `bad-json` sends one non-JSON event; `end-fail` sends an `error` event for the End Chapter call only.

**Extending it:** one behaviour per key, keep CORS on every response, and add the key to the printout and to [testing.md](../testing.md) (skill, "Extending the mock AI server").

## The QA step script

[scripts/qa-step.mjs](../../scripts/qa-step.mjs) is for the `qa-tester` agent (decision 57), not for CI. It runs one file of Playwright steps against a **persistent** Edge profile under `test-results/qa/profile/<name>`, so state carries over between steps like a real user's session. Options: `--fresh` wipes the profile, `--key` puts a mock key into sessionStorage before the page loads, `--profile`, `--name`, `--width`, `--height`. It needs `npm run dev` and `npm run mock-ai` already running, and prints the URL, an accessibility snapshot, console errors, failed requests and a screenshot path.

[.claude/launch.json](../../.claude/launch.json) names the two servers (`web` on 1420, `mock-ai` on 8787) for the desktop app's preview.

## Couplings to keep in step

Changing one of these without the other breaks tests, not the app:

| In the app | Read by |
| --- | --- |
| System message openings in [prompt.ts](../../src/lib/prompt.ts) (`Write the epilogue`) and [endChapter.ts](../../src/lib/endChapter.ts) (`You are the editor`) | `requestKind` in the mock, `callKind` in fixtures |
| `Direction: ` and `Hint for this version: ` lines in `nextBlock` | `promptParts` in the mock |
| `### <name> (main character)` and `## Scenes the story has already used` in `buildEndChapterPrompt` | `endChapterText` in the mock |
| `Chapter N has just ended` in the End Chapter system message | `endChapterText` in the mock |
| The block format (`=== NEXT ===`, `MAIN CHARACTER DIED:`, `MOOD:`, `PICTURE:`) | `blockText`, `moodLine`, `BLOCK` |
| `Then the picture line` in `PICTURE_RULE` | the mock's picture line check |
| `data-music` on `<html>` and `data-picture` on picture places | [music.spec.ts](../../e2e/music.spec.ts), [pictures.spec.ts](../../e2e/pictures.spec.ts) |
| Labels, button names and `aria-label`s in the pages | E2E locators and [helpers.ts](../../e2e/helpers.ts) |
| sessionStorage key `ang-dev-api-key` in [secrets.ts](../../src/lib/secrets.ts) | [qa-step.mjs](../../scripts/qa-step.mjs) `--key` |

**Rust tests.** `cargo test --lib` in `src-tauri/` runs the three tests of `move_old_data` in [lib.rs](../../src-tauri/src/lib.rs) (decision 154). They use temporary folders and are not part of `npm run test:all`.
