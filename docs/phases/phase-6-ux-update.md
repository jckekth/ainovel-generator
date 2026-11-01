# Phase 6: UX update (v0.2)

**Status:** Done
**Spec sections:** 3, 4, 5.1, 5.4, 5.6, 6.3, 6.5, 6.6, 7.1, 8, 9, 11 (decisions 68, 69, 71, 72, 83–88)

## Goal

The app speaks the user's language and helps more while writing: Chinese UI, better defaults, easier chapter reading, visible token use, and suggestions that say what they might do.

## Tasks

- [x] Move every UI text into translation files; English, Simplified Chinese and Traditional Chinese (decision 68); a UI language choice in Settings, separate from the novel's language
- [x] Novel languages limited to the UI's three: English, 简体中文, 繁體中文 (decision 71). Malay, Japanese, Korean and "Other…" leave the list; a story already in one of them still opens and writes, with the general native-prose note (spec 6.5) and English examples
- [x] A new story's language starts as the UI language; the user can still pick another (decision 71)
- [x] Curated sets per story type (decision 72): each fills every setting field that differs by genre (era and place, world background, tone, trope, pace, ending and the like, the rank ladder for cultivation), with a main character and a name pool that fit its era and place; in all three novel languages (decisions 44, 45, 71)
- [x] A new story starts with a random set of its type; this is its "default" (decision 72)
- [x] Choice values sent to the AI in the novel's language (e.g. "Happy" as 歡樂 in a Traditional Chinese story), taken from the same translation files as the UI; the files on disk keep the English value, so changing languages never breaks a saved story
- [x] Previous / next chapter links at the top and bottom of the chapter reader
- [x] Tokens used per block and per chapter, from the provider's usage report (`stream_options.include_usage`); estimated and marked as such when the provider sends none
- [x] Suggested actions carry a short note on what each might do to the story (block format change, spec 6.3); blocks saved before the change still show their actions
- [x] Randomize buttons: on the Setting page, another curated set; on a character form, a name from the setting's name pool (and, for the main character, the set's main character)
- [ ] "Ask the AI" for a new random setting or name, when the curated sets are not enough *(optional, one small request; not built in this pass: the four sets per type cover the first need, and it waits on real use; carried over to Later in progress.md)*
- [x] Visible progress for long steps: a modal with a spinner and the current step while End Chapter saves the chapter and writes its summary (and while the epilogue is accepted); while a block is written, "Writing…" and Stop sit in the bottom action bar, where the block streams into view *(user feedback 2026-10-15: the only sign was a notice at the top of the page)*
- [x] Unit and E2E tests

## Acceptance checks

- [x] Switching the UI language changes every label, button, message and error on every page, in all three languages, and the novel's language is unchanged.
- [x] A new story of each type starts filled with one of its curated sets, and two new stories of the same type can start differently.
- [x] With the UI in 繁體中文, a new story defaults to 繁體中文, and its setting and main character start in 繁體中文; the same for 简体中文 and English.
- [x] In a Chinese story's AI log, the setting, the main character and the choice values are in Chinese; only the instructions and field keys are in English.
- [x] A story created earlier in Japanese, Korean or Malay still opens and writes blocks.
- [x] From any earlier chapter, the reader can go to the previous and next chapter without returning to the chapter list.
- [x] After a chapter, the tokens it used are shown; with the mock's usage report they match it exactly.
- [x] Each suggested action shows a note, and picking it still writes the next block.
- [x] Ten randomized settings in a row never mix an era with a place or names from another set.
- [x] From anywhere on the page, the user can see that End Chapter or a block is still working, and what it is doing.

## How to check

Run `npm run mock-ai` and use the mock keys (docs/testing.md); the mock reports usage and writes action notes.

1. Settings → Appearance → Language: switch to 繁體中文, then 简体中文, then English. Visit the story list, a story (Novel, Characters, Setting), the review, Settings and the setup guide; open a dialog and trigger an error (key `sk-test-rate-limit`). No English is left in Chinese and no Chinese in English, apart from story content; the story's language is unchanged.
2. Create three cultivation stories and three romance stories: each opens with a filled setting, and at least two of the same type differ. Reopen one before saving: the same world.
3. With the UI in 繁體中文, create a story: its language is 繁體中文, and the setting and the main character are in 繁體中文. Repeat for 简体中文 and English.
4. Write a block in a 繁體中文 story and open the newest file in `ai-log/`: the setting values (tone, era and the like), the main character and the choice values are in Chinese; the field keys and the instructions are in English.
5. Open a story created before phase 6 in 日本語 (Japanese), or edit a test story's `story.json` and `setting.md` to that language: it opens and writes blocks.
6. End two chapters and open chapter 1 from the list: "next" goes to chapter 2, "previous" back to chapter 1, and from chapter 2 "next" returns to the current chapter.
7. With `sk-test-valid` (each call reports 1,200 input and 300 output tokens), write two blocks, regenerate one, then End Chapter: the review shows 4,800 input and 1,200 output tokens. With `sk-test-no-usage` the numbers show "≈" and "estimated".
8. Each suggested action shows a note; clicking one writes the next block.
9. Press Randomize on the Setting page ten times: each time the era, place, background, sects or ladder belong to one set. On a character form, Random name gives a name that fits the gender and is not already used.
10. Scroll to the top of a long chapter and write a block with `sk-test-stream-slow`: "Writing…" and Stop are in the bottom bar. End Chapter with `sk-test-stream-slow`: a dialog shows the steps and Stop.
