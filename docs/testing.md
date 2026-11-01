# Test plan

Last updated: 2026-10-22

How the app is tested, what each layer covers, and the direction for the phases still to come. The how-to for adding tests is in [.claude/skills/testing/SKILL.md](../.claude/skills/testing/SKILL.md).

## 1. Direction

- **Test the logic where it lives.** Almost every rule in the spec is enforced in `src/lib/`, not in the pages. Unit tests cover `src/lib/` thoroughly; the pages are covered by a smaller set of end-to-end flows.
- **No Tauri in automated tests.** `storage.ts`, `secrets.ts` and `ai.ts` already fall back to browser storage and `fetch` when not inside Tauri (decision 26). Unit tests run in jsdom and E2E tests run against `npm run dev`, so both use the browser implementations with nothing mocked.
- **No real AI in automated tests.** All AI calls go to `scripts/mock-ai-server.mjs` or a stubbed `fetch`. Each mock API key selects one behaviour (success, 401, 429, bad JSON, slow…). New AI features add new mock keys.
- **The real app stays a manual checklist.** What only the Tauri shell can do (credential store, real files, File Explorer, installer) is checked by hand using the acceptance checks in each phase file. Automated tests do not replace those checks; they stop regressions between them.
- **Spec-traceable.** Each test names the spec rule it protects in its title or a comment, e.g. `"refuses a second main character (spec 7.1)"`.

## 2. Layers

| Layer | Tool | Runs | Covers | Command |
| --- | --- | --- | --- | --- |
| Types | `tsc --noEmit` | Node | Whole `src/`, tests included | `npm run build` |
| Unit | Vitest + jsdom | Node, no browser | `src/lib/*` functions and their files on the browser store | `npm test` |
| Config contract | Vitest | Node | `src/storyTypes/*.json` are well formed and match the spec | `npm test` |
| End to end | Playwright | Microsoft Edge (installed with Windows) against `npm run dev` and the mock AI server | User flows from the phase acceptance checks that work in the browser preview | `npm run test:e2e` |
| Real app | Manual | `npm run tauri dev` / installer | Tauri-only behaviour | Phase files |

Everything automated in one go: `npm run test:all`.

### File layout

```
src/lib/<module>.test.ts      unit tests, next to the module
src/test/setup.ts             clears browser storage before each test
src/test/storyTypes.test.ts   config contract tests
e2e/*.spec.ts                 Playwright flows
e2e/helpers.ts                shared steps (create story, save key…)
playwright.config.ts          starts the dev server and the mock AI server
```

## 3. Unit tests (current code, phases 1–6)

Each line is one or a few test cases. IDs are for reference in reviews and the log.

### i18n (U-IN), src/i18n/i18n.test.ts

- `t` fills placeholders with grouped numbers, reads the language from `setLocale` (`tIn` any language), falls back to English for an unknown one; `tCount` uses the singular where the language has one (spec 11, decision 83).
- Both Chinese files have every English key with the same placeholders, are written in Chinese (no text left in English), and the Simplified file holds no Traditional characters.
- Every story type's name, description, labels, hints, placeholders, scale ends, options and sections have both Chinese translations; each field's options stay distinct in every language and read back to the saved English value (decision 84). Labels, options and type names follow the UI language; a value with no translation shows as saved.
- After a hot reload in `npm run dev` the module keeps the chosen language (CR6-07).
- `detectLocale`: zh-TW, zh-HK, zh-Hant-MO give 繁體中文, other Chinese 简体中文, anything else English. `novelLocale`: the three novel languages map to their translations, Japanese and Malay to none (spec 6.5).

### markdoc.ts (U-MD)

- Parses header and body; no header gives an empty header and the whole text as body.
- Strips a byte-order mark; accepts CRLF line endings.
- `---` inside a value (`a---b`) does not end the header; an empty header `---\n---` parses.
- Invalid YAML and a header that is a list both throw a readable error.
- Formatting puts short plain lists on one line and long lists as a block; an empty body writes no body.
- Round trip `parse(format(doc))` keeps the doc, including Chinese text, colons and quotes (decision 28).

### fields.ts (U-FD)

- `defaultValue`: each field type; a `default` is deep-cloned (editing it does not change the config); scale defaults to the midpoint.
- `coerce`: number from string, junk falls back to the default, list from a single string, ladder from strings, objects and junk, text from an array.
- `normalize`: trims text, drops empty list lines, drops nameless ranks, non-finite number becomes null.
- `rankOptions`: ranks with and without stages.
- `valuesFromHeader` / `headerFromValues`: unknown keys kept as extra and written back at the end; hidden fields left out; field order kept.
- `validate`: required, ladder message, min age (missing and too low), whole number, min/max, multi max, rank not in ladder, choice not in options, hidden fields skipped.
- `localizeChoices` puts choice and multi values in a language and leaves other fields; `choiceToEnglish` reads them back from any language (decision 84).

### storyTypes.ts (U-ST) and config contract (C-CFG)

- `getStoryType` throws a readable error for an unknown id; `storyTypeName` falls back to the id.
- Setting fields: common first. Character fields: head, type fields, tail; status last.
- For every story type: field keys unique across the merged lists; every type is a known `FieldType`; choice and multi fields have options and their default is one of them; scale defaults lie within min..max; `prompt` is a non-empty list of strings; every `mainCharacterRequired` key exists.
- A Story length field with Short story / Long story / Continuous, default Continuous (decision 47).
- Every setting field except the language has a default; multi defaults are options and within the limit; each type has an example world background; `settingDefaults` only names existing fields; each genre has its own default tone (decision 44); the example main character uses only known fields, none hidden for the main character, and passes validation against the default rank ladder (decision 45).
- Spec rules: romance `minAge` is 18 (decision 16); cultivation main character requires `special_ability` (spec 7.3); cultivation has a non-empty default rank ladder (spec 8.3); the common setting has a main character death field defaulting to "only when I direct it" (decision 20).
- The novel languages are English, 简体中文 and 繁體中文 (decision 71).
- Curated sets (decisions 72, 85): at least three per type with unique ids; each covers the same fields in all three languages, with a background, a main character background and name pools of the same size; in every language the set's values are known setting fields and pass validation, its main character uses only known fields not hidden for the main character and passes validation against the set's own ladder; no name repeats in a pool or is the main character's.

### storage.ts, browser store (U-FS)

- Write then read; reading a missing file throws.
- `exists` is true for a file and for a folder; `stories/ab` does not match `stories/abc`.
- `list` gives direct children once each, folders marked; a missing folder gives an empty list.
- `remove` deletes a folder and everything in it but not a sibling with the same prefix.
- `readJson` / `writeJson` round trip.

### stories.ts (U-SR)

- A new story gets one of its type's curated sets at random, or the one given (decisions 72, 85).
- `makeId`: slug plus 6-character suffix; capped at 32 characters; a title with no Latin letters (Chinese) uses the fallback.
- Create, get, list newest first; a folder without a readable `story.json` is skipped.
- `updateStory` keeps the id and bumps `updatedAt`; `deleteStory` removes the whole folder.

### settings.ts and secrets.ts (U-SE, U-SC)

- Defaults when there is no file; an older file is merged over the defaults; a corrupt file gives the defaults; save and load round trip.
- The saved settings file never contains an API key (decision 3).
- The UI language starts from the system language, keeps a saved choice, and an unknown one in the file is replaced (spec 11).
- `applyAppearance` sets the theme attribute and the reading-size variable.
- Browser mode keeps the key in sessionStorage: set, get, delete.

### tokens.ts (U-TK)

- Mixed-text estimate: one per Chinese, Japanese or Korean character, words × 4/3 for the rest; the provider's report is used when there is one, otherwise an estimate marked `estimated`; sums stay estimated once any part is; tokens read from a file ignore junk; formatted in the UI language with "≈" when estimated (spec 6.6, decision 87).

### curatedSets.ts (U-CS)

- A set by id, or the type's first for a story without one; Randomize never picks the set shown and reaches every set; text in the novel's language, English for others; copies, so a form edit never changes the set; `applySet` fills only the set's fields and the background; a new novel language swaps only untouched text; Random name fits the gender, skips taken names (any case) and the current one, and is null once all are used (spec 7.1, 8; decisions 72, 85).

### ai.ts (U-AI), with `fetch` stubbed

- `explainStatus` for 401, 403, 404, 429, 5xx and others; a chat 400 or 404 points to the model name (decision 56).
- `providerMessage`: `error.message`, a string `error` or `message` from JSON, short plain text; HTML pages and JSON without a message are ignored; long messages are shortened. The provider's words follow ours for chat and the connection test.
- `listModels`: no key, a base URL without http(s), network failure, non-OK status, bad JSON. Each gives its plain-words message (spec 9).
- Sorts model ids and drops ids that are not strings; joins the base URL with or without trailing slashes; sends the Bearer header.
- `SseDecoder`: lines split across pieces, CRLF (also split between pieces), keep-alive comments and other fields skipped, several data lines joined, a last event without a closing blank line.
- `streamChat`: posts model, messages, `stream: true` and `stream_options.include_usage`; reads the usage from the last stream chunk or a JSON body, ignores a missing or broken one, asks once more without `stream_options` when a 400 names it, and does not retry other 400s (spec 6.6, decision 87); reports the text so far as it arrives; skips chunks without content; keeps a multi-byte character split between chunks; accepts a stream without `[DONE]` once a `finish_reason` came, and a provider that answers with one JSON body; a stream that closes with neither is "broke off", and `finish_reason: "length"` (streamed, with or without `[DONE]`, or in a JSON body) is "cut off at the output limit" (decision 74); asks for a key and a model first; explains a network failure, an error status, a connection that breaks off mid-stream, an error event inside the stream and a stream that is not JSON; throws `AiStopped` when aborted before or during the stream.

### block.ts (U-BL)

- Splits story text, 2–3 actions and the died flag (spec 6.3); reads yes / true / y; strips list markers, `ACTION:` and bold; keeps at most three actions; accepts CRLF, a lower-case marker and any number of `=`; Chinese actions and `1、` markers.
- No marker: story text kept, no actions, flag off (decision 37). A scene break of `=` signs is not the marker. Empty answer gives empty text.
- A marker at the end of a story line (decision 90): split into text, actions and notes; never shown while streaming, nor a marker still arriving; a scene break of `=` stays story text; `stripSuggestions` removes a saved marker and its lines. The note separator keeps the letters next to the bar.
- Action notes (decision 86): `action | note` and the full-width `｜` split into actions and notes, a line without a bar has an empty note, a line that is only a note is dropped.
- `visibleText`: whole text before the marker; hides the marker and what follows; holds back a last line that may become the marker.
- A bare flag line without the marker (decision 54): removed from the story text but still read (yes pauses on a death); bold and `main_character_died` forms; a story line that only mentions the words is kept; hidden while streaming, and a story line that merely starts like it shows once it differs. Saved drafts and chapters are cleaned when read; `chapter.md` is not rewritten.

### scene.ts (U-SN)

- Latin-script names match as whole words only (`Ann` not in `annual`, `Annabel`, `Ann2`), case-sensitive (`Will` not in `will`); full names with spaces, accents and punctuation (decision 40).
- Chinese, Japanese and Korean names match anywhere; a Latin name next to Chinese text matches.
- `charactersInScene`: main character always first; others when named in any text; inactive characters left out, dead ones kept (spec 6.1).

### prompt.ts (U-PR)

- One system and one user message (decision 41); layers in the order of spec 6.1, checked both by layer id and by heading position; phase 4 layers and empty notes left out.
- Setting file with background, notes list, blocks in full, direction last; "no direction" opening; regenerate hint after the direction.
- Instructions: the genre's prompt fragments; language, point of view with the main character's name, tone, narration detail, content rating (fade to black, decision 15); each main character death rule (spec 5.5); safe defaults for unknown values; the response format.
- Characters in the scene: main character and named characters only; names found in blocks, hint and the previous chapter's summary; no relationship field for the main character.
- Story length and chapter length (spec 5.3, 5.7): the length rule in the instructions, the arc stage and the chapter's length next to the direction, the ending steer at the target and the conclusion at the hard limit, characters counted for Chinese.
- Earlier chapters: Rich adds the characters named in the last 3 chapters; the previous chapter's tail in characters for Chinese.
- Epilogue (spec 5.5): Short length, no block format, death rule or current chapter; mentions an accepted death.
- Request size (phase 5 checks 1–2): with realistic layer sizes, Lean < Balanced < Rich at chapter 6 (1 / 3 / 5 summaries, no / 300 / 600 tail words); chapter 10 is under 1.5× chapter 2 on Balanced, and chapter 30 is the same size as chapter 10.
- Used scenes (spec 6.4): sent as layer 6 under the rule not to stage them again, left out when empty; only the newest lines within the budget's cap are sent, in their order; every block is asked to bring something new; a later chapter without a direction opens where the last one left off (decision 65).
- Choice values (spec 6.5, decision 84): a Traditional or Simplified Chinese story sends the setting's and characters' choices, the tone and the narration detail in Chinese with English field keys; English and Japanese stories keep English values; the setting itself is unchanged.
- Budget levels (spec 6.2): the caps table, with the used scenes cap; header only on Lean, full file on Balanced and Rich; number of recent summaries; previous chapter tail length, none on Lean; unknown budget falls back to Balanced.

### languageStyle.ts (U-LS)

- Nothing for English; the native-prose rule for every other language, a typed-in one too (spec 6.5, decision 70).
- Traditional and Simplified Chinese notes in their own script, with 「」 or “” for dialogue, and the main character's name in the example action; no Traditional characters in the Simplified notes; no action note for the epilogue.
- In the prompt: the "Writing in" section between "How to write" and "Genre", absent for English, without the action note in the epilogue; End Chapter asks for openings that are not requests.

### draft.ts (U-DR)

- Append, regenerate and switch versions are pure; earlier versions kept and the new one chosen; switching back; the chosen version is fixed and the others dropped when the next block is written (decision 39); only the latest block changes; nothing to regenerate in an empty draft.
- Missing draft starts the next chapter; save and reopen round trip; a hand-edited draft is tidied; a corrupt draft gives a plain-words error.
- Setting lock with a real draft (spec 8.1).
- Epilogue drafts: an ending story's empty draft is the epilogue; the flag survives save and load; the draft can be deleted (decision 52).
- A hand-edited draft drops a non-text action together with its note (CR6-08).
- A saved block with the marker in its text is split into text, actions and notes when read (decision 90).
- Tokens and notes (spec 6.6, decision 86): every new block and version adds to the chapter's total, which keeps them after the version is dropped; blocks without tokens leave it unset; notes and tokens survive save and load; an old draft loads without them.

### novel.ts (U-NV), with `fetch` stubbed

- First block: draft saved and returned; the prompt holds setting, main character and direction; only story text reported while streaming; died flag stored; a block without suggestions kept; blocks so far sent for the next block.
- Regenerate: new version with the hint, earlier one kept; the replaced block is not sent but its direction is; refused with no block.
- The draft file is unchanged after an error status, the network off, Stop, an empty block and a cut-off answer (spec 9, decisions 38 and 74); asks for a key and a model first.
- The story moves to the top of the story list.
- `nextBlockBlocked` (spec 5.3, 5.5, decision 49): allowed below the hard limit and for the block that crosses it; blocked after the concluding block, on a death and after the epilogue; enforced by `writeBlock`, which still allows a regenerate.
- A stale draft (fewer blocks than on disk) is refused and the file is unchanged (decision 91).
- After the `stream_options` retry, the AI call log records the body that answered (CR6-05).
- Tokens and notes (spec 6.6): the provider's tokens go on the version and the chapter's total, regenerations included; no report gives an estimate; the prompt asks for a note after each action; a stopped block counts nothing.
- AI call log: a successful block is logged with prompt, raw answer and parsed actions, never the key; an error (with the part that arrived), a stopped call and a regenerate each get their own file (decision 46).

### length.ts (U-LN)

- Chinese and Japanese count characters, Korean and other languages words (decisions 24, 48); word and character counts.
- Chapter limits for each length and unit, Medium as fallback; open below the target, soft from the target, hard from 150% (spec 5.3); progress of the blocks so far.
- Tail by words, or 5/3 characters per word without spaces; token estimate words × 4/3 or one per character; a token cap in words or characters (decision 53).
- Story length (spec 5.7, decision 47): planned chapters; the pacing rule per length; arc stages for a short story (set-up, rising, finale in the last two, wrap-up after), a long story by volume, and a continuous one (never a finale); End story highlighted once the planned chapters are written.

### chapters.ts (U-CP)

- Three-digit folders; `chapter.md` written once and never overwritten (spec 5.4); title and next chapter openings in the summary's YAML header, rename keeps both and the summary; default titles.
- A chapter saved with the marker in its text reads without it; `chapter.md` is not rewritten (decision 90).
- Used scenes list (spec 6.4): empty without `scenes.md`, one "- " line per scene, a hand-edited file read with other bullets and blank lines.
- Chapter list in order with titles and "summary pending", skipping folders without `chapter.md` and surviving a broken `summary.md`; story summary read and write.
- Snapshot copies `setting.md` and every character file, replaces an older snapshot, and is not touched by later edits (decision 12).
- Story context: empty before chapter 1; story summary, used scenes, chapter summaries oldest first, previous chapter, last 3 chapters; the chapter being written and chapters without a summary are left out.

### endChapter.ts (U-EC), with `fetch` stubbed

- `parseEndChapter`: every part, with the used scenes and up to three next chapter openings (empty or non-text items dropped); code fence and text around the JSON; missing title and lists; plain-words errors for non-JSON and a missing summary (decision 51).
- `buildEndChapterPrompt`: JSON shape, summary cap in words or characters, compression asked only when over the cap (spec 6.1); the used scenes sent, the whole updated list and two or three openings asked for, merging asked only when the list is over its cap (spec 6.4); an age always asked for, at least the minimum in romance (decision 67); field list, characters without hidden fields, story so far and chapter text.
- `checkProposals`: a valid change with the old value from the file; drops unknown characters and fields, name changes, hidden fields, values the field does not allow, and no-change values; coerces numbers and lists, an emptied list is a change; new characters keep known fields, and are dropped without a name or when the name exists (spec 7.5); a missing, unreadable or too low age gets the type's default age and is flagged, a young age with no minimum stays (decision 67).
- Flow (decision 50): End Chapter saves the chapter, summaries and proposals; the draft and setting lock stay until the review is finished; finishing needs every answer; approving writes the change at once; snapshot holds the approved change; the next chapter starts empty; chapter 2's prompt gets chapter 1's summary, the story so far and its end.
- A failed summary call keeps `chapter.md`, shows "summary pending", refuses new blocks and versions in the ended chapter, and the retry completes it (spec 5.4).
- A write that fails after the AI answers (the story summary) leaves the chapter's `summary.md` unwritten, so the chapter stays "summary pending" and Retry saves the summary and the proposals (decision 76).
- One End Chapter call per story: a second `summarizeChapter` while one runs is refused and only one call reaches the AI; an aborted call (leaving the story) keeps the chapter "summary pending" and Retry works (decision 77).
- A failed `story.json` write right after `chapter.md` (decision 75): `reconcileStory` raises the chapter count on load and then changes nothing more, and chapter 2 starts; an accepted death survives it without a reload, because `finishChapter` copies it from the draft; a death left in the draft by a failed `chapter.md` write is cleared when the chapter is then ended without one.
- Approving a proposal that already has an answer changes no file; after a failed `review.json` write, a second Accept of a new character whose name now exists is refused and only one file exists (spec 7.5, decision 78).
- New characters: accepted as they are, or "edit first" when they fail the form's checks; a romance character without an age is accepted as it is with the default age (decision 67); proposals or characters that are gone are explained.
- Tokens (spec 6.6, decision 87): the chapter's `summary.md` holds its blocks, a regenerated version and the End Chapter call (4 × the mock's report); a rename keeps them; a failed End Chapter call is not counted; the epilogue saves its own total.
- Ranks (CR6-02): the End Chapter call lists the story's own ladder in its language, with no English example.
- Choice values (decision 84): the End Chapter call lists the allowed values and sends the characters' choices in the novel's language; Chinese values in proposals read back to English, English still accepted.
- Used scenes and openings: End Chapter saves both; chapter 2's prompt holds the used scenes; an answer without scenes keeps the old list (spec 6.4).
- Ending (spec 5.5, decision 52): accepted death → chapter ends with `ending: death` → epilogue draft → epilogue prompt mentions the death → regenerate, no second block → accept → Completed with an "Epilogue" chapter and snapshot. End story only between chapters, epilogue without a death.

### errors.ts (U-ER)

- The app's own messages are kept; full browser storage, a data folder that cannot be written, a full disk and a missing file (named) become plain words with the next step (spec 9). An AI error is kept as it is, even when the provider's words say "quota" (decision 58).

### unsent.ts (U-US)

- Starts empty; keeps the direction and the hint apart, per story; forgets a story once both are cleared (decision 59).

### devlog.ts (U-DL)

- On in development builds and tests; messages written exactly as sent, raw answer, facts (time, duration, endpoint, body fields, prompt facts); error and partial answer; "nothing arrived"; code fences survive backticks in the text.
- File names sort by time; the entry lands in the story's `ai-log/`; only the newest 100 files are kept; a failed write never throws.
- Manual: `npm run build` leaves the log out of the production bundle.

### setting.ts (U-SG)

- A new story's setting is the defaults, the story's curated set (its English text for a language outside the three) and the story's language, `saved: false`; it passes validation untouched for every story type (decision 44); the same set on every visit until saved; a Chinese story's setting starts in its own script; saving writes the set to `story.json`; a story from before sets gets the type's first set (spec 8, decision 85).
- `hasStarted` (decision 89): false for a new story, true with a block in the draft or an ended chapter; the language can change before that; afterwards `saveSetting` refuses a new language (read from disk, so a stale story object cannot get past it) but saves other changes.
- Save writes readable `setting.md`, updates the language in `story.json` (decision 31), and keeps unknown header keys.
- `isSettingLocked`: false with no draft, true with blocks, false with an empty or corrupt draft (spec 8.1).
- Notes: loading strips `-` and `*` bullets and blank lines; saving writes a `- ` list.

### characters.ts (U-CH)

- A new main character starts as the given example (by default the type's first set in English), other characters start empty, and editing a new character does not change the example (decisions 45, 85); `exampleMainCharacter` gives the story's set's main character in the story's language.
- Save gives an id and writes `main_character` after `name`; fields hidden for the main character are left out.
- A second main character is refused; the main character can be saved again (spec 7.1).
- List: main character first, then by name; an unreadable file is reported, not thrown.
- `requiredKeys` adds the type's main-character keys and `age` when the type has a min age.
- Delete: the main character is refused; a character whose name is in a chapter is refused; otherwise the file is removed.
- `getReadiness` reports setting and main character.

## 4. End-to-end tests (browser preview)

Run against `npm run dev` with a fresh browser profile per test, so each test starts as a first launch. The mock AI server runs on port 8787.

| ID | Flow | From |
| --- | --- | --- |
| E2E-01 | First launch opens Settings with the guide | Phase 1 |
| E2E-02 | Saving a key shows "Key saved"; test connection with `sk-test-valid` lists 3 models; a wrong key says it was rejected; `sk-test-rate-limit` explains the limit | Phase 1 |
| E2E-03 | Theme and font size apply at once and survive a reload | Phase 1 |
| E2E-04 | Create a story, it opens; it is listed after a reload; deleting removes it | Phase 1 |
| E2E-05 | A cultivation story shows the cultivation setting fields; a saved setting reopens intact after a reload | Phase 2 |
| E2E-06 | A cultivation main character cannot be saved with the special ability cleared; after saving, no second main character can be added | Phase 2 |
| E2E-07 | A romance character under 18 cannot be saved | Phase 2 |
| E2E-08 | The Novel tab checklist ticks the setting, then unlocks the Novel page once the main character exists | Phase 2 |
| E2E-09 | The first block streams in with three suggested actions and no format lines; the prompt holds the main character and the direction; a suggested action writes the next block; the Setting tab is locked | Phase 3 |
| E2E-10 | A typed direction is followed; regenerate with a hint adds version 2; the previous version can be restored; a reload resumes the same blocks and chosen version | Phase 3 |
| E2E-11 | Stop during a slow block discards it and keeps the earlier block | Phase 3 |
| E2E-12 | A connection dropped mid-stream and the network off are explained; the draft is unchanged after a reload | Phase 3 |
| E2E-13 | A block without suggestions asks for a typed direction and never shows its bare flag line; a block with the died flag pauses on the death choice | Phase 3, decision 54 |
| E2E-14 | A new story's setting starts as one of its curated sets and saves without typing anything | Decisions 44, 72 |
| E2E-15 | The main character form starts as the set's main character and saves without typing, in both story types; other new characters start empty | Decisions 45, 85 |
| E2E-16 | End Chapter → review: the AI's title and summary, two checked proposals, Finish disabled and setting locked until all are answered; approve one, reject one, edit the title; chapter 2 starts, setting unlocked, the approved change is on the character; the chapter list opens the chapter read-only | Phase 4 |
| E2E-17 | Short chapter length with long mock blocks: the progress bar counts, End Chapter is highlighted past the target, the block at the hard limit concludes the chapter and only End Chapter is left | Phase 4 |
| E2E-18 | A failed End Chapter call keeps the chapter ("summary pending"), no next chapter, and the retry opens the review | Phase 4 |
| E2E-19 | Died flag → accept the death → review → epilogue with a direction → regenerate → accept → Completed, both chapters readable | Phase 4 |
| E2E-20 | End story appears between chapters only, and leads to an epilogue without a death | Phase 4 |
| E2E-21 | Every mock error on the Novel page (wrong key with the provider's words, 403, 429 rate limit, 429 no credit, 500, not JSON, dropped stream, stream closed early, cut off at the output limit, no key) names the problem and the next step, and nothing is written | Phase 5 |
| E2E-22 | Leaving a story with unsaved Setting edits asks first, from "← All stories" and from the side rail; Keep editing returns to the Setting tab, Discard leaves the saved setting unchanged | Phase 5 |
| E2E-23 | A direction and hint typed before an error are still there after going to Settings and back; leaving mid-block asks, Stay keeps it going, leaving discards it and keeps the direction; a written block clears both | Decision 59 |
| E2E-24 | While the first block of chapter 1 is being written, the Setting tab is locked (note, fields, Save); after Stop it opens again | Spec 8.1, decision 61 (P3-01) |
| E2E-25 | An edited chapter title in the review is still there after leaving the story and after a reload, and is the one the chapter gets at Finish | Spec 5.4, decision 60 (P4-01) |
| E2E-26 | With a character form open and the Setting tab mounted beside it, every label finds its own field and no id is repeated on the page | P2-03, P4-06 |
| E2E-27 | Main character death set to Never: a died block pauses with only Regenerate (no Accept the death), and a regenerated death still cannot be accepted | Spec 5.5, decision 62 (P4-02) |
| E2E-28 | On a long chapter scrolled to the top, the progress bar and End Chapter are still on screen in the action bar; End Chapter's colour is not the primary buttons' colour | Phase 5b, decision 64 |
| E2E-29 | Chapter 2 starts with an empty direction, and the AI is told to open where the last chapter left off | Phase 5b, decision 65 |
| E2E-30 | The Start chapter 2 screen offers the two openings from chapter 1's End Chapter call; picking one writes the first block with it, and the openings go | Phase 5b, decision 65 |
| E2E-31 | In a romance story, the new character the AI gave no age shows "set to 25", is accepted without typing, and has age 25 | Phase 5b, decision 67 |
| E2E-32 | Write a block with `sk-test-valid`, switch the key to `sk-test-no-credit`, then End Chapter: the error says the account has no credit, with the provider's words, not that the browser's storage is full; the chapter is kept | Spec 9, decision 58 |
| E2E-33 | Write a block, switch to `sk-test-stream-slow`, End Chapter: the progress dialog shows the AI step and what stopping means; its Stop leaves the chapter saved with no error; back with `sk-test-valid`, "Try the summary again" opens the review | Spec 9, decisions 77, 88 |
| E2E-34 | First launch opens the setup guide; a provider's button fills in its base URL; after closing, it does not open again on a later visit to Settings, and the Setup guide button opens it | Spec 9, decisions 81, 82 |
| E2E-35 | Switching the UI to 繁體中文 changes Settings in place, an error from `src/lib`, the setup guide, the story list, the new story dialog (language defaults to 繁體中文), the setting (Chinese world and sections) and the main character (Chinese name, Random name); back to English, the story keeps 繁體中文 | Spec 11, decision 71 |
| E2E-36 | A 简体中文 romance story written with a tagged key sends era, trope, gender and status in Chinese, never in English | Spec 6.5, decision 84 |
| E2E-37 | Ten Randomize clicks each give another world; switching the novel language swaps the set's text but keeps a typed field; the setting saves | Spec 8, decision 85 |
| E2E-38 | Random name changes the name to another one; "Use the setting's main character" brings the example back | Spec 7.1 |
| E2E-39 | With the mock's usage report, the action bar and each block show 1,200 / 300 per call; after two blocks, a regenerate and End Chapter, the review and the chapter reader show 4,800 / 1,200; with `sk-test-no-usage` the total shows "≈ … (estimated)" | Spec 6.6, decision 87 |
| E2E-40 | Suggested actions show their notes (the third has none); picking one sends the action alone | Spec 6.3, decision 86 |
| E2E-41 | From chapter 1, the reader's links go to chapter 2 and back, the bottom links work, and "Current chapter →" returns to Start chapter 3 | Spec 5.6 |
| E2E-42 | While a slow block is written, "Writing…" and Stop are in the action bar, which is in view; Stop there discards the block | Decision 88 |
| E2E-45 | The delete-story dialog takes focus, Tab and Shift+Tab stay inside it, and Escape gives focus back to the book's menu button that opened it | CR6-06 |
| E2E-46 | Write a block in chapter 2, read chapter 1, come back with "Current chapter →": the block is there, the next one goes after it, and both survive a reload | Decision 91 |
| E2E-47 | With `sk-test-stream-inline-marker`, the marker glued to the last line is never shown and its two actions (with notes) are offered | Decision 90 |
| E2E-48 | The top bar has Stories, Settings and About; About shows the version, JC Do Things and the email, and Copy puts the email on the clipboard | Spec 10, decision 107 |
| E2E-49 | The bookshelf puts the last opened story first, a Chinese title runs vertically, the last place is "New story", Escape closes the book's menu with focus back on its button, and Delete is in that menu | Decisions 96, 109 |
| E2E-50 | A fantasy story is set up without typing: its setting saves as it is, the main character has a race and rank from the set; class Other asks for the typed class, which is saved; a block is written | Spec 7.6, 8.5, decisions 105, 114 |
| E2E-51 | With the adventurer ranks cleared, a fantasy character has no rank field, nor does the set's main character | Decision 104 |
| E2E-52 | A romance story shows its background; the figure follows the gender (Non-binary shows the neutral one) and holds still while a field has focus; Background art off shows no art | Spec 12.3, decisions 99, 111 |
| E2E-53 | At 900 × 600 the chapter list is behind a Chapters button, marks the current chapter, and closes with its button or Escape (focus back on Chapters) | Spec 12.1, decision 100 |
| E2E-54 | With motion on, entering a story shows the book opening, and a click ends it at once | Spec 12.4 |
| E2E-55 | With reduced motion, the book does not open and the background does not drift | Spec 12.4 |
| E2E-57 | Music comes in only at a peak block, plays on through a block with no mood and on other tabs of the story, pauses on leaving the story and resumes on return; a new peak takes over | Spec 13.2, 13.3, decisions 130–132 |
| E2E-58 | Turning music off stops it at once and nothing plays while it is off; the volume setting is saved | Spec 9, 13.3 |
| E2E-59 | The About page credits every music track under CC BY 4.0 | Spec 13.1, decision 134 |
| E2E-60 | Pictures start on None; Settings shows the price per picture and per chapter, which follows the quality, and says when a model's price is unknown; the image connection test finds the image model | Spec 14.1, decisions 140–142 |
| E2E-61 | Rich puts a picture under every block, its request carrying the type's style, the scene line and the main character's appearance; the finished chapter shows both pictures in the reader | Spec 14.2, 14.3, decisions 143–146 |
| E2E-62 | A refused picture says why with Try again, the block's text stays, and the next block is written | Spec 14.4, decision 147 |
| E2E-63 | Lite draws no picture under blocks, and one at End Chapter from the chapter's scene, shown in the review | Spec 14.2, 14.3 |
| E2E-64 | With pictures on None, writing a block and ending the chapter send no picture request | Spec 14.1, phase 8 acceptance check |
| E2E-56 | A General story: the setting starts empty with no Randomize, and Save refuses until the genre and style and the world are filled; the main character starts empty with no Random name and needs only a name; Write stays off until a direction is typed, for the first block, the next block and chapter 2; no suggestions under a block and no chapter openings | Spec 5.1, 7.7, 8.6, decisions 125, 126, 128 |
| E2E-44 | Before chapter 1, Randomize and the language field work; after chapter 1 ends, the setting is editable but the language is disabled with its note and Randomize is gone | Decision 89 |
| E2E-43 | A story whose `story.json` and `setting.md` say 日本語 (Japanese) opens, shows the language on the Setting tab, and writes a block with the Japanese prose rule and English choice values | Decision 71 |

### Phase 8: music

Built on 2026-10-31; the tests are in `src/lib/music.test.ts` (U-MU), additions to U-BL (block), U-DR (draft), U-PR (prompt) and the settings tests, and E2E-57 to E2E-59.

- **Unit (U-MU):** the six moods and nothing else; a bundled MP3, a credit and a level for every mood, battle and tense lower than the rest; what a finished block does to the music (keep or play); the player does nothing where there is no Web Audio.
- **Unit, block:** the mood line is read, never shown and never taken for an action, also without the marker and while streaming; none, unknown and missing read as no mood. Draft: a known mood is saved with the version, an unknown one dropped. Prompt: the mood list with `none` for most blocks, and a happy or sad mood for the epilogue. Settings: music on at 50% by default, the volume kept between 0 and 100.
- **Mock AI:** every block ends with a mood line: a mood its direction or hint names as a word ("a battle at the gate"), otherwise `none`; the epilogue ends `MOOD: triumphant`.
- **E2E:** the player mirrors its state on `<html data-music>` ("battle playing", "battle paused" or empty), which the tests read; Edge plays the real tracks.
- **Manual:** listen: the fade in, the single play and the fade out, the levels of the six tracks next to each other, and how often a real AI asks for music over a chapter.

### Phase 8: pictures

Built on 2026-11-01; the tests are in `src/lib/pictures.test.ts` (U-PI), the End Chapter test's answer shape, and E2E-60 to E2E-64.

- **Unit (U-PI):** the picture line is read after the marker and without it, never shown, held back while streaming; writeBlock asks for it and saves the scene only on Rich, and sends no picture request on None; the picture prompt joins the type's style, the scene and the appearance of the named characters only (Chinese names too); every type has a style; the scene from a block's text is its last 600 characters; the price per picture and per chapter, and "not known"; the settings' defaults and tidying; the image key, or the text AI's with the switch on, and the message when it is missing; the request body, a link instead of the picture, a refusal told apart, a wrong model, no credit and a wrong key in plain words; a drawn picture saved under its version's name and logged without the picture or the key; a refusal kept as the picture's state with the draft unchanged, and Try again drawing it; a finished chapter keeping the chosen versions' pictures after the right paragraph and dropping the rest; Lite asking End Chapter for the scene, saving it and drawing the chapter's picture, and nothing on None; the log entry of a picture.
- **Mock AI:** a picture line when the prompt asks for one; a `picture` field in the End Chapter answer when asked for; Elder Wu comes with an appearance; `POST /v1/images/generations` answers with a small PNG, a different colour each time, and `GET /v1/_last-image-request` returns that key's last picture request.
- **E2E:** each picture place carries `data-picture` ("drawing", "shown", "failed" or "make"), which the tests read.
- **Manual (real image key):** a character looks recognisably the same from chapter to chapter; each picture shows its scene; a Mature scene that is refused leaves the story and draft unchanged; the cost per picture matches the provider's bill; pictures and keys in the installed app (Credential Manager, files in the story folder).

### Mock AI keys

`npm run mock-ai` prints this list too. Base URL `http://127.0.0.1:8787/v1`, any model name.

| Key | Models | Chat completion |
| --- | --- | --- |
| `sk-test-valid` | 4 models | A normal block; echoes the direction and hint it was given; two of its three actions have notes. Every complete stream ends with `finish_reason: "stop"`, a usage report (1,200 input, 300 output tokens) when `stream_options.include_usage` is asked for, and `[DONE]` |
| `sk-test-no-usage` | 4 models | A normal block with no usage report, so tokens are estimated (spec 6.6) |
| `sk-test-rejects-usage` | 4 models | A 400 naming `stream_options` when it is sent, a normal block without it (decision 87) |
| `sk-test-one-model`, `sk-test-no-models` | 1 model, none | A normal block |
| `sk-test-slow` | 4 models after 5 seconds | A normal block; for the connection test's waiting state |
| `sk-test-stream-died` | 4 models | A block where the main character dies (flag `yes`) |
| `sk-test-stream-slow` | 4 models | A normal block streamed over about 15 seconds, for Stop |
| `sk-test-stream-error` | 4 models | Half a block, then the connection drops |
| `sk-test-stream-cut` | 4 models | Half a block, then the stream closes cleanly with no `[DONE]` or `finish_reason` (decision 74) |
| `sk-test-stream-length` | 4 models | Half a block, then `finish_reason: "length"` and `[DONE]`, as when the output limit is reached (decision 74) |
| `sk-test-stream-inline-marker` | 4 models | A block whose `=== NEXT ===` ends the last story line, with two actions and no flag line (decision 90) |
| `sk-test-stream-malformed` | 4 models | A block without the `=== NEXT ===` line, ending in a bare `MAIN CHARACTER DIED: no` line |
| `sk-test-stream-long` | 4 models | Blocks of about 860 words, to reach the chapter length limits in a few blocks |
| `sk-test-end-chapter-fail` | 4 models | Normal blocks, but the End Chapter call fails with an error |
| `sk-test-new-character-no-age` | 4 models | Normal blocks, but End Chapter's new character "Elder Wu" comes without an age |
| `sk-test-bad-json` | not JSON | A stream that is not JSON |
| `sk-test-no-credit` | 429 with code `insufficient_quota` | Same, like OpenAI when the account has no credit (decision 58) |
| `sk-test-forbidden`, `sk-test-rate-limit`, `sk-test-server-error` | 403, 429, 500 | Same status |
| `sk-test-image-refused` | 4 models | A normal block; every picture request gets 400 `moderation_blocked`, like a picture the safety system refused (spec 14.4) |
| `sk-test-image-slow` | 4 models | A normal block; pictures arrive after about 3 seconds, for "Drawing…" |
| `sk-test-image-error` | 4 models | A normal block; every picture request gets 500 |
| anything else | 401 | 401 |

Every key that writes blocks also answers the End Chapter call (a fixed JSON answer: one valid change for the main character, one invalid change that the app drops, a new character "Elder Wu", the used scenes it was sent plus one for the chapter, and two openings for the next chapter: "Train with Elder Wu at dawn (after chapter N)" and "Go back down the mountain to the village") and the epilogue call. A key may end in `~<tag>`; the tag does not change the behaviour, and `GET /v1/_last-request` with that key returns the last chat request body it sent (`GET /v1/_last-image-request` the last picture request). Every key that answers with models also answers picture requests with a small PNG, unless its row says otherwise. The fourth model, `mock-image-1`, is for the image model setting.

The E2E browser runs with the `en-US` locale (`playwright.config.ts`), because the UI language follows the system's on first launch (spec 11).

Not covered here (browser preview cannot do it): Windows Credential Manager, files on disk, "Open data folder", restart of the real app. These stay as manual checks in the phase files.

## 5. Direction for phases 3–6

Write these tests together with the feature, in the same change.

### Phase 3: writing loop

Built on 2026-10-07; the tests are listed in sections 3 and 4 (U-BL, U-SN, U-PR, U-DR, U-NV, E2E-09 to E2E-13).

- **Mock server:** add `POST /v1/chat/completions` with streaming (SSE `data:` lines, `[DONE]`). New keys: normal block, block with main-character-died flag, slow stream (for Stop), error mid-stream, malformed block (no suggested actions). Record the last request body so tests can inspect the prompt.
- **Unit:** the stream parser (chunks split mid-line, CRLF, `[DONE]`, keep-alive comments); the block response parser (text, 2–3 suggested actions, died flag, malformed input); "characters in the scene" name matching (spec 6.1: main character always, names in chapter / direction / previous summary, no partial-word false positives in English, Chinese names); prompt builder layer order (spec 6.1); draft save/load and regenerate variants (spec 5.2: only the latest block, earlier versions kept, fixed after the next direction); setting lock with a real draft.
- **E2E:** first block streams in; suggested action produces the next block; regenerate with hint; switch back to an earlier version; Stop keeps earlier blocks; reload resumes the draft; Setting tab locked; mock error leaves the draft unchanged.

### Phase 4: chapters

Built on 2026-10-09; the tests are listed in sections 3 and 4 (U-LN, U-CP, U-EC, E2E-16 to E2E-20).

- **Unit:** word count for spaced languages and character count for Chinese (decision 24); soft limit and hard limit at 150% (spec 5.3); End Chapter response parser (title, chapter summary, story summary, proposals); chapter files written once and never overwritten; snapshot copies setting and characters; failure after `chapter.md` is saved keeps it and blocks the next chapter until the summary exists (spec 5.4); story completed after the epilogue.
- **E2E:** End Chapter, review proposals (approve one, reject one), title edit, chapter list opens a read-only chapter; main character death → accept → epilogue → Completed.

### Phase 5: polish

Built on 2026-10-12; the tests are listed in sections 3 and 4 (U-ER, U-US, request size, E2E-21, E2E-22, E2E-23).

- **Unit:** budget levels change the prompt as the table in spec 6.2 says (caps, number of recent summaries, tail length, character detail), measured on the request body; prompt with chapter 10 vs chapter 2 stays within a set ratio; content rating appears in the instructions.
- **E2E:** every error the mock server can produce shows a message that names the problem and the next step.
- **Manual:** installer on a clean machine (phase 5 checks).

### Phase 5b: fixes before v0.1

Built on 2026-10-14; the tests are listed in sections 3 and 4 (U-CP, U-EC, U-PR, C-CFG default age, E2E-28 to E2E-31).

- **Mock server:** the End Chapter answer adds `scenes` and `next_openings`; a new key whose new character has no age.
- **Unit:** End Chapter parser reads scenes and openings, and tolerates their absence; a missing or too low age is filled with the type's default and flagged; `scenes.md` is layer 6 and is capped per budget (spec 6.2); the over-cap instruction appears when the list is too long; a story without `scenes.md` builds the same prompt as before; config contract: every story type has a default age at or above its minimum.
- **E2E:** start chapter 2 with an empty direction; start chapter 2 from an offered opening; accept the mock's new character in a romance story without typing; the action bar stays in view after scrolling a long chapter.
- **Manual:** button look and repeated scenes over a long real story (phase 5b checks 2 and 6).

### Phase 6: UX update (v0.2)

Built on 2026-10-18; the tests are listed in sections 3 and 4 (U-IN, U-TK, U-CS, C-CFG sets, additions to U-AI, U-BL, U-DR, U-NV, U-EC, U-PR, U-SR, U-SG, U-CH, U-SE, U-FD; E2E-35 to E2E-43).

- **Mock server:** a usage report on every call that asks for it; action notes; `sk-test-no-usage` and `sk-test-rejects-usage`; the End Chapter JSON streams in big pieces so the review comes quickly under parallel load.
- **Unit:** translation files complete and in Chinese; story type texts translated with distinct options; choice values to and from the novel's language; curated sets complete in three languages and valid; Randomize, language swap and name pool rules; tokens from the report, estimated otherwise, summed per chapter with regenerations and the End Chapter call.
- **E2E:** the UI language switch, a Chinese story's prompt, Randomize, Random name, tokens against the mock's report, action notes, reader links, Writing… in the action bar, a Japanese story from before phase 6.
- **Manual:** phase 6 checks 1, 4 and 5 in the real app; a real provider's usage report (check 7).

### Phase 7: look and feel (v0.3)

Built on 2026-10-29; the tests are listed in sections 3 and 4 (C-CFG fantasy and art, additions to U-FD, U-SR, U-SE, U-EC; E2E-48 to E2E-55).

- **Config contract:** fantasy has its fields, its four sets valid in three languages, a main character whose race and rank are in the set's own lists; every type has its background and the three figures are found.
- **Unit:** End Chapter proposals checked against the setting's races and ranks and the class rules (CR-01, CR-03); the installer placeholder check (`src/about.test.ts`); pick options from a list (the name before a colon, also a Chinese colon), a choice with Other typed in, the last-opened order, the Background art setting, and the End Chapter prompt listing a fantasy story's own races.
- **E2E:** run with reduced motion (decision 117); E2E-54 turns motion back on.
- **Manual:** phase 7 acceptance checks in the real app; the About page in the installed build; the installer build stopping on the itch.io placeholder.

### Phase 7b: General story type

Built on 2026-10-30; the tests are in `src/lib/general.test.ts` (U-GN), C-CFG general and E2E-56.

- **Config contract:** General is the only type without suggestions and without curated sets (the set checks run for the other types); its four setting fields start empty with a placeholder; it has one character field and an SVG background.
- **Unit (U-GN):** the setting and main character start empty; the block prompt asks for no suggested actions but keeps the marker and the death flag; the End Chapter prompt asks for no openings; a block without a direction is refused; actions and openings the AI sends anyway are dropped; regenerate needs no new direction.
- **Mock AI:** follows the prompt: no actions when the block prompt says not to suggest, no `next_openings` unless asked for.
- **Manual:** with a real provider, a chapter in an unusual genre keeps to the genre and style and the rules of this world.

## 6. Rules

- `npm run test:all` passes before a phase is marked "Built, not verified".
- A bug fix comes with a test that failed before the fix, where the bug is in `src/lib/` or a flow E2E can reach.
- Tests do not call a real AI provider, need an API key, or depend on test order.
- Coverage of `src/lib/` (`npm run test:coverage`) is kept at 90% lines or more. The pages are not measured.
- Log each full test run that changes a phase's status in `progress.md`.
