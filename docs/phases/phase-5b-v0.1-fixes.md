# Phase 5b: Fixes before v0.1

**Status:** Done
**Spec sections:** 5.1, 5.4, 6.1, 6.2, 6.4, 7.5

## Goal

Fix the five problems found by the user in real use, so the base version (v0.1, decision 63) can be called done. Phase 5's open checks are still needed too.

## Tasks

- [x] Action bar fixed to the bottom of the Novel page with the progress bar and End Chapter (decision 64)
- [x] Own colour and icon for End Chapter and End story; End story outlined until the finale, then solid
- [x] Direction optional for the first block of every chapter (decision 65)
- [x] End Chapter call returns 2–3 openings for the next chapter; saved in the chapter's `summary.md`; shown on the Start chapter screen as buttons that write the first block
- [x] Used scenes list: `scenes.md`, returned by the End Chapter call, capped and merged when over the cap, sent as prompt layer 6 (spec 6.4, decision 66)
- [x] Writing instructions: every block brings something new; do not stage used scenes again
- [x] End Chapter prompt always asks for an age at or above the type's minimum; a missing or too low age is filled with the type's default age, and the review card says so (decision 67)
- [x] Default age for new characters in each story type file
- [x] Mock AI server: End Chapter answer with `scenes` and `next_openings`; a key whose new character has no age
- [x] Unit and E2E tests (testing.md, "Phase 5b")

## Acceptance checks

- [x] On a long chapter, the progress bar and End Chapter stay visible at the bottom while scrolling, in the light and dark theme and at the smallest window size.
- [x] End Chapter and End story can be told apart from every other button at a glance, without reading their labels.
- [x] Chapter 2 or later can be started with an empty direction, and by picking one of the offered openings.
- [x] In a romance story, a new character proposed at End Chapter can be accepted without typing anything, and it has an age of 18 or higher.
- [x] After End Chapter, `scenes.md` lists the chapter's scenes, and the next block's request contains the list (the `ai-log/` file shows it).
- [x] In a story of eight chapters or more written with a real provider, the user no longer notices scenes recurring from earlier chapters.

## How to check

- **Automated:** E2E-28 (check 1, one window size), E2E-29 and E2E-30 (check 3), E2E-31 (check 4); unit tests cover what check 5 reads from the files.
- **Checks 1–4:** run `npm run mock-ai` and `npm run tauri dev`, base URL `http://127.0.0.1:8787/v1`, key `sk-test-valid`. For check 4 use a romance story and the mock key whose new character has no age.
- **Check 5:** open the story folder after End Chapter, then the newest file in `ai-log/`.
- **Check 6:** needs a real provider and the user's judgement. Write the story with the same model that looped before, and compare with the story that looped.
