# Technical docs

Last checked against the code: 2026-11-01

How the code is built, for an engineer about to change it. What the app does is in [spec.md](../spec.md); why it is that way is in [decisions.md](../decisions.md). These pages describe the code as it is and are kept by the `tech-writer` agent (decision 73).

## Pages

| Page | Covers |
| --- | --- |
| [architecture.md](architecture.md) | The layers (translations included), the rules between them, navigation and the UI language switch, the story workspace, the Novel page states, busy states and the progress dialog |
| [modules.md](modules.md) | Every file in `src/lib/` and `src/i18n/`: job, exports, imports, tests; and the pages and components that call them |
| [data-and-storage.md](data-and-storage.md) | The data folder, file formats (tokens, action notes, `setId`, `uiLanguage`), which code writes each file and when, End Chapter in files, snapshots, the browser store, the API key |
| [ai-pipeline.md](ai-pipeline.md) | A block from button press to saved draft: prompt layers, choice values in the novel's language, request and usage report, streaming, parsing actions and notes, token counts, errors, Stop; the epilogue, the End Chapter call and the AI call log |
| [story-types.md](story-types.md) | The story type JSON format, curated sets, field types and their translations, how values are read and checked, keys the code knows by name, adding a type |
| [music-and-pictures.md](music-and-pictures.md) | Phase 8: the mood line and the music player, picture levels, the picture request, drawing in the background, picture files, costs |
| [platform.md](platform.md) | Tauri versus the browser preview: `isTauri`, the Rust commands, moving the old data folder, plugins, capabilities, the CSP, build settings, what only the real app exercises |
| [testing-internals.md](testing-internals.md) | How Vitest, Playwright, the fixtures, the mock AI server and the QA script are wired |
| [drift.md](drift.md) | Where the code and the other docs disagree |

## Where to start

1. Read [architecture.md](architecture.md) for the layers and the rules between them.
2. Run the app in the browser preview: `npm run mock-ai` and `npm run dev`, then in Settings use base URL `http://127.0.0.1:8787/v1`, any model name and the key `sk-test-valid`. Open the story's `ai-log/` entries (in the preview they are in localStorage under `ang-file:stories/<id>/ai-log/`; in `npm run tauri dev` under `%APPDATA%\ainovelgenerator\stories\<id>\ai-log\`) to see each prompt as sent.
3. Follow one block through [ai-pipeline.md](ai-pipeline.md), with [novel.ts](../../src/lib/novel.ts) and [prompt.ts](../../src/lib/prompt.ts) open beside it.
4. Before changing a file, read its row in [modules.md](modules.md) and the "Invariants and gotchas" list of the page that covers it, then its test file.
5. After the change: `npm test`, and `npm run test:all` before a phase is marked built (see [testing.md](../testing.md)).
