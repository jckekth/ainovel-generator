# Phase 3: Novel page, core writing loop

**Status:** Done
**Spec sections:** 5.1, 5.2, 6

## Goal

The user can write a chapter block by block with the AI: give a direction, read the streamed block, regenerate or continue. Chapters cannot be ended yet.

## Tasks

- [x] Streaming chat completion call in the AI module, with a Stop control
- [x] Prompt builder: instructions, setting, pinned notes, characters in the scene, current chapter, direction
- [x] "Characters in the scene" name matching
- [x] Block response format: story text, two or three suggested next actions, main-character-died flag
- [x] Novel page: reading view, direction input, suggested actions
- [x] Regenerate the latest block, with an optional hint
- [x] Keep earlier versions of the latest block and allow switching back
- [x] Draft autosave to `draft/draft.json` after every block
- [x] Resume the draft when the story is reopened
- [x] Setting page locked while a draft has blocks
- [x] API errors shown in plain words; a failed block leaves the draft intact

## Acceptance checks

- [x] With a setting and a main character, the first block generates and streams onto the page.
- [x] The block uses the main character's name and matches the story's language, tone and point of view. *(2026-10-08, real provider: name, language and point of view confirmed. Tone needs a longer run to judge; carried over to Known gaps in progress.md.)*
- [x] Suggested actions appear under the block; choosing one produces the next block.
- [x] A typed direction is followed in the next block.
- [x] Regenerate replaces the latest block; with a hint, the new block reflects the hint.
- [x] An earlier version of the latest block can be restored.
- [x] Stop cancels a block in progress without losing earlier blocks.
- [x] Closing the app mid-chapter and reopening it shows the same blocks.
- [x] The Setting page cannot be edited while the chapter has blocks.
- [x] With the network off, generating shows a clear error and the draft is unchanged.

## How to check

Run `npm run mock-ai` and `npm run tauri dev`. In Settings: base URL `http://127.0.0.1:8787/v1`, any model name (e.g. `mock-novelist-v1`), key `sk-test-valid`. Other keys for single checks are listed in [testing.md](../testing.md#mock-ai-keys): `sk-test-stream-slow` (Stop), `sk-test-stream-error` (a failed block), `sk-test-stream-died`, `sk-test-stream-malformed`. The mock echoes the direction and hint it received, so checks 3–5 can be seen in its text.

Check 2 (the main character's name, language, tone and point of view) needs a real provider key: the mock writes the same English text every time.
