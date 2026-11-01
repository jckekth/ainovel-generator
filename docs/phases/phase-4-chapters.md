# Phase 4: Chapters

**Status:** Done
**Spec sections:** 5.3, 5.4, 5.5, 5.6, 5.7, 6, 7.5

## Goal

Chapters can be ended, summarised and read back, the story stays consistent over many chapters, and a story can reach its ending.

## Tasks

- [x] Word and character counting per language, with a progress bar
- [x] Soft limit: steer the AI toward an ending and highlight End Chapter
- [x] Hard limit: write a concluding block and end the chapter
- [x] End Chapter: save `chapter.md` as read-only
- [x] End Chapter AI call: title, chapter summary, updated story summary, character proposals
- [x] Retry when the End Chapter call fails; block the next chapter until it succeeds
- [x] Review screen: edit the title, approve or reject each character change, accept new characters
- [x] Snapshot of setting and characters per chapter
- [x] Prompt builder: add story summary, recent chapter summaries and previous chapter tail (the inputs and caps already exist in `prompt.ts`), and the Rich budget's characters from the last 3 chapters (decision 43)
- [x] Summary compression when the story summary passes its cap
- [x] Chapter list and read-only chapter view
- [x] Main character death: flag handling, regenerate or accept
- [x] "End story" button between chapters
- [x] Epilogue chapter and Completed status
- [x] Story length setting (spec 5.7): the field, arc pacing in the prompt, finale steering, End story highlighted after the planned chapters

## Acceptance checks

- [x] The progress bar tracks the chapter's length against its target.
- [x] Past the soft limit, blocks move toward a chapter ending.
- [x] At the hard limit, the chapter ends by itself after a concluding block.
- [x] After End Chapter, `chapters/001/` holds `chapter.md`, `summary.md` and a `snapshot/` folder.
- [x] An approved character change is written to the character file; a rejected one is not.
- [x] A new character proposed by the AI can be accepted and then appears on the Character page.
- [x] Chapter 2 continues from chapter 1's events without the user restating them.
- [x] An earlier chapter opens read-only and cannot be changed.
- [x] The Setting page can be edited between chapters, and chapter 1's snapshot keeps the old values.
- [x] If the End Chapter call fails, the chapter text is kept and Retry completes it.
- [x] With "Main character death" set to Never, a direction asking for the death does not kill the main character.
- [x] An accepted death ends the chapter, writes an epilogue and marks the story Completed.
- [x] "End story" writes an epilogue and marks the story Completed.
- [x] A Completed story is readable and cannot start a new chapter.
- [x] With Story length set to Short story, the AI call log of chapter 7 or 8 shows the finale instruction, and after chapter 8 the End story button is highlighted.
- [x] With Story length set to Continuous, the instructions say the story has no planned end.

## How to check

Run `npm run mock-ai` and `npm run tauri dev`. In Settings: base URL `http://127.0.0.1:8787/v1`, any model name, key `sk-test-valid`. The mock's End Chapter answer always proposes "Condition: Wounded in the left arm" for the main character and a new character "Elder Wu". Keys for single checks ([testing.md](../testing.md#mock-ai-keys)): `sk-test-stream-long` (length limits, with Chapter length Short), `sk-test-end-chapter-fail` (a failed End Chapter call), `sk-test-stream-died` (death and epilogue).

Checks 7 (chapter 2 continues from chapter 1), 11 (Never prevents a death) and the two Story length checks depend on what the AI writes, so they need a real provider key. The AI call log in the story's `ai-log/` folder shows what was sent.
