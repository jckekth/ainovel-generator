# Phase 2: Setting and Character pages

**Status:** Done (2026-10-07)
**Spec sections:** 3, 4, 7, 8

## Goal

The user can fill in a story's world setting and create its characters, for both story types. The files on disk are ready to be sent in a prompt.

## Tasks

- [x] Story type config format: character fields, setting fields, prompt fragments, main character rule
- [x] Cultivation and romance config files
- [x] Markdown with YAML header: read and write
- [x] Form builder that renders fields from a config (text, number, choice, list, scale)
- [x] Setting page: common fields plus story type fields, saved to `setting.md`
- [x] Default rank ladder for cultivation, editable
- [x] Character list: add, open, mark dead or inactive
- [x] Character form: common fields plus story type fields, saved to `characters/<id>.md`
- [x] Main character rules: exactly one, cannot be deleted, required fields enforced
- [x] Age 18 or higher enforced in romance stories
- [x] Pinned story notes editor, saved to `notes.md`
- [x] Novel tab checklist reads the real state (setting saved, main character exists)

## Acceptance checks

Run these in the real app (`npm run tauri dev`).

- [x] A cultivation story shows the cultivation fields on both pages; a romance story shows the romance fields.
- [x] A saved setting reopens with every value intact after a restart.
- [x] `setting.md` and a character file open in a text editor as readable markdown with a YAML header.
- [x] A character's rank can only be picked from the story's rank ladder.
- [x] A cultivation main character cannot be saved without a special ability.
- [x] A second main character cannot be created.
- [x] A romance character with an age under 18 cannot be saved.
- [x] The Novel tab checklist ticks both items once the setting and main character exist.

## Notes

- Story type configs: `src/storyTypes/common.json` (fields every type shares), `cultivation.json`, `romance.json`. Field types: text, longtext, number, choice, multi, list, scale, rank, ladder, language.
- All checks above passed in the browser preview on 2026-10-06, plus: setting reopens after reload, a hand-edited rank outside the ladder is flagged, the main character has no Delete button, notes are saved as a markdown list, no second window scrollbar at 640×500.
- The setting lock (spec 8.1) reads `draft/draft.json`, which phase 3 creates. Until then the setting is never locked.
- A character can be deleted only if its name does not appear in any `chapters/*/chapter.md`. With no chapters yet, any character except the main one can be deleted.
- All acceptance checks passed in the real app on Windows on 2026-10-07.
