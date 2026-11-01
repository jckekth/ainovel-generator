# AI Novel Generator

Tauri 2 + React + TypeScript desktop app. Start with `README.md` and `docs/README.md`.

- Docs lead code: spec first (`docs/spec.md`), a row in `docs/decisions.md` for any choice, tick tasks in the phase file, update `docs/progress.md` when a status changes.
- Tests: see `docs/testing.md` (plan) and the `testing` skill (`.claude/skills/testing/SKILL.md`). Run `npm test` after changing `src/lib/`; run `npm run test:all` before marking a phase built.
- `npm run dev` is the browser preview (localStorage store, no Tauri). `npm run mock-ai` is the fake AI API on port 8787.
- Write code that reads like the surrounding code: short doc comments that explain why, plain-words user messages that say what to do next.
