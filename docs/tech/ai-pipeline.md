# AI pipeline

Last checked against the code: 2026-11-01

How a block goes from a button press to saved text, and how the End Chapter call and the epilogue use the same path. What happens after a block is saved (music, pictures) is in [music-and-pictures.md](music-and-pictures.md). The rules are in [spec.md](../spec.md) sections 5 and 6; the file formats in [data-and-storage.md](data-and-storage.md).

## A block, end to end

```mermaid
sequenceDiagram
  participant W as ChapterWriter (NovelTab.tsx)
  participant N as writeBlock (novel.ts)
  participant P as buildPrompt (prompt.ts)
  participant L as loggedCall (novel.ts)
  participant A as streamChat (ai.ts)
  participant B as block.ts
  participant D as draft.ts
  W->>N: story, draft, direction or regenerate hint, AbortSignal, onText
  N->>N: chapterEnded? nextBlockBlocked? loadAiConfig
  N->>P: setting, notes, characters, budget, blocks, loadStoryContext
  P-->>N: messages (system + user), layers, scene
  N->>L: messages, facts, read = parseBlock
  L->>A: POST base URL + /chat/completions, stream true, include_usage
  A-->>W: onText(raw) through visibleText, many times
  A-->>L: onUsage(usage) from the last chunk, if sent
  A-->>L: full text
  L->>B: parseBlock(raw)
  L-->>N: ParsedBlock and tokens (callTokens; writeAiLog in development)
  N->>D: appendBlock or addVersion (adds tokens), then saveDraft
  N-->>W: the saved Draft
```

### 1. The page starts it

`ChapterWriter.run` in [NovelTab.tsx](../../src/pages/NovelTab.tsx) is the only caller. It is reached from the Start chapter form, an offered chapter opening, a suggested action (decision 42; only the action is sent, never its note, decision 86), the direction form, Regenerate, and the death pause. While it runs, the action bar shows "Writing…", a spinner and Stop (decision 88). It:

- returns at once if a call is already running (`abort.current`);
- makes an `AbortController` and sets `streaming` to `""`, which tells the workspace a block is being written (`onWritingChange`), so the Setting tab locks (decision 61) and leaving asks first;
- calls `writeBlock` with `{ direction }` or `{ regenerate: { hint } }`.

### 2. Checks before any request

`writeBlock` in [novel.ts](../../src/lib/novel.ts) throws before the network is touched when:

- regenerating with no block;
- the draft's chapter already has a `chapter.md` (an ended chapter is read-only, spec 5.4), except for the epilogue;
- `nextBlockBlocked` returns a reason (only for a new block, never for a regenerate): the epilogue is written, the latest block has the died flag, or the blocks before the latest one already reached the hard limit, so the latest one was the conclusion (decision 49);
- `loadAiConfig` finds no key ("There is no API key yet…").

### 3. The prompt

`writeBlock` gathers the inputs: `loadSetting`, `loadNotes`, `listCharacters`, `loadSettings().contextBudget`, the chosen text of each block (`chapterTexts`), and `loadStoryContext` from [chapters.ts](../../src/lib/chapters.ts) for earlier chapters. For a regenerate it sends the blocks **without** the latest one, the latest block's original direction, and the hint.

`buildPrompt` in [prompt.ts](../../src/lib/prompt.ts) returns two messages (decision 41): a system message for layer 1 and one user message with the other layers under `##` headings, in the order of spec 6.1. Empty layers are left out. `Prompt.layers` lists the ids that were sent and `Prompt.scene` the character names; both go into the AI log.

| # | `LayerId` | Heading | Source | Limit (`BUDGETS`, spec 6.2) |
| --- | --- | --- | --- | --- |
| 1 | `instructions` | system message | Setting values, `storyType.prompt`, `languageStyle` | none |
| 2 | `setting` | `## Setting` | `setting.md` re-formatted with `localizeChoices` + `headerFromValues` + `formatMarkDoc` | full |
| 3 | `notes` | `## Pinned story notes` | `notes.md` | full |
| 4 | `characters` | `## Characters in the scene` | `charactersInScene` | `characterDetail`: header only on Lean, header and background otherwise; fields hidden for the main character left out |
| 5 | `story-so-far` | `## The story so far` | story `summary.md` | sent in full; kept short by the End Chapter call |
| 6 | `used-scenes` | `## Scenes already used` | `scenes.md` | newest lines within `usedScenesTokens` (`newestWithin`) |
| 7 | `recent-chapters` | `## Recent chapters, oldest first` | chapter `summary.md` files | last `recentSummaries` |
| 8 | `previous-tail` | `## End of the previous chapter` | previous `chapter.md` | `tailText` of `previousTailWords` (0 on Lean) |
| 9 | `chapter` | `## Chapter N so far` | the draft | full; left out for the epilogue |
| 10 | `direction` | `## Next block` or `## The epilogue` | `nextBlock`: arc stage, chapter length so far, soft or hard limit note, direction, hint | none |

**The system message** is built by `instructions`: an opening line, `## How to write` (language, point of view with the main character's name, tone, narration detail, content rating, the death rule, the story length rule, "keep every character true"), `## Writing in <language>` for any language other than English ([languageStyle.ts](../../src/lib/languageStyle.ts), spec 6.5), `## Genre` (the type's `prompt` lines) and `## Answer format` with the `=== NEXT ===` marker, two or three actions each followed by ` | ` and a short note in the novel's language (decision 86), the flag line, the mood line (`MOOD_RULE`, spec 13.1) and, only when Pictures is on Rich, the picture line (`PICTURE_RULE`, spec 14.2) (spec 6.3).

**Types without suggestions** (`hasSuggestions(type)` false: General, decisions 125, 126). The answer format asks for no actions and says the user decides every block; the language line and `languageStyle` drop the actions. The page requires a direction for every block, and the End Chapter call asks for no `next_openings`.

**Choice values in the novel's language** (spec 6.5, decision 84). The instructions are English, but every choice value the AI reads is in the novel's language: `settingChoice` for the tone and narration detail in the system message, and `localizeChoices` for the setting and character files (layers 2 and 4). `choiceLocale` is `novelLocale(language)`, or `en` for a language outside the three. Field keys stay in English. Point of view, content rating and the death rule are not sent as values: their English option text picks an English sentence from `POINT_OF_VIEW`, `CONTENT_RATING` and `DEATH_RULE`.

**Characters in the scene** ([scene.ts](../../src/lib/scene.ts)): the main character, plus every character whose full name `mentions` finds in the blocks sent, the direction, the hint, the previous chapter's summary and, on Rich, the texts of the last 3 chapters. Characters with status `Inactive` are left out unless they are the main character.

**Lengths** come from [length.ts](../../src/lib/length.ts): `chapterProgress` for the soft and hard limit notes (spec 5.3), `storyArcStage` and `storyLengthRule` for pacing (spec 5.7), `tailText` and `estimateTokens` for caps (decision 53). Chinese and Japanese are counted in characters (`countsCharacters`).

### 4. The request

`loggedCall` in [novel.ts](../../src/lib/novel.ts) wraps `streamChat` in [ai.ts](../../src/lib/ai.ts):

- `checkConfig`: a key, and a base URL starting with `http://` or `https://`; then a model name.
- `httpFetch` uses the Tauri HTTP plugin in the app (runs in Rust, so no CORS) and the browser's `fetch` elsewhere. See [platform.md](platform.md).
- `POST <baseUrl>/chat/completions`, `Authorization: Bearer <key>`, body `chatBody(model, messages)` = `{ model, messages, stream: true, stream_options: { include_usage: true } }` (decision 87). No temperature, token limit or penalties are sent (decision 66 on penalties).
- **Retry without the usage option.** If the answer is a 400 or 422 whose provider message names `stream_options` or `include_usage` (`rejectsUsageOption`), `streamChat` posts once more with `chatBody(model, messages, false)`. Any other error status, or a second failure, throws as below.
- The base URL is trimmed and trailing slashes removed before the path is added (`joinUrl`).

### 5. Streaming

- A response with `Content-Type: application/json` is read as a whole answer (`choices[0].message.content`, and `usage`), for providers that ignore `stream: true`.
- **Usage.** With `include_usage`, the provider sends `usage` (`prompt_tokens`, `completion_tokens`) in a last chunk with no choices. `readUsage` turns it into a `Usage` (`input`, `output`) or `null` when it is missing or not numbers, and `streamChat` passes it to `onUsage`.
- Otherwise the body is read with a `TextDecoder` (multi-byte characters split across chunks are kept) and fed to `SseDecoder`, which collects `data:` lines, joins multi-line events, skips comments and other fields, and handles CRLF and a last event without a closing blank line.
- Each event is `[DONE]` (end), a chunk whose `choices[0].delta.content` is added to the text, or an `error` object (thrown). The last `choices[0].finish_reason` is kept. A stream that closes without `[DONE]` is complete only if a `finish_reason` came; otherwise it "broke off". A `finish_reason` of `length`, streamed or in a JSON body, throws "cut off at its output limit" (decision 74).
- After each piece `onText` gets the **whole text so far**. `writeBlock` passes it through `visibleText` from [block.ts](../../src/lib/block.ts): only the text before the marker, holding back a last line that may still become the marker or the flag line (decision 54). The page shows it in the streaming block.

### 6. Parsing

`parseBlock` in [block.ts](../../src/lib/block.ts):

- Finds the marker with a lenient pattern: any number of `=` (two or more), any case, spaces allowed.
- With the marker: the text before it is the story; each later line is an action or the flag line (`yes`, `true` or `y` means died). For an action, list markers, `ACTION:` and `**` are stripped, the line is split at `|` or the full-width `｜` (`NOTE_SEPARATOR`), the first part is the action and the rest the note (`""` when there is no bar). At most `MAX_ACTIONS` = 3; `notes[i]` belongs to `actions[i]`. `complete: true`.
- After the marker, a `MOOD:` line gives `mood` (only a known mood; `none` or unknown gives nothing) and a `PICTURE:` line gives `picture`; both are read wherever they sit after the marker and never shown.
- Without the marker: the whole answer is the story, no actions or notes, `complete: false` (decision 37); bare flag, mood and picture lines are still read and removed (decision 54).
- An empty story text makes `writeBlock`'s `read` throw "The AI sent back an empty block. Try again."

### 7. Saving

`writeBlock` builds a `BlockVersion` (`text`, `actions`, `notes`, `died`, `hint`, `createdAt`, `tokens`, and `mood` and `picture` when the answer had them; `picture` only on Rich). For the epilogue, `actions` and `notes` are always empty and `died` false. Then:

- new block: `appendBlock` (the previous block keeps only its chosen version, decision 39);
- regenerate: `addVersion` (earlier versions kept, the new one chosen).

Both add the version's tokens to the draft's `tokens` total (`withTokens`), so a version dropped later still counts (spec 6.6).

`saveDraft` writes the file, `updateStory` bumps `updatedAt`, and the page gets the new draft. It clears the direction and hint ([unsent.ts](../../src/lib/unsent.ts)), tells the workspace the draft changed, passes the chosen version's mood to `music.blockFinished`, and on Rich starts `drawBlockPicture` without waiting for it.

## Token counts

Spec 6.6 and decision 87; the code is in [tokens.ts](../../src/lib/tokens.ts).

- `loggedCall` keeps the last `Usage` that `onUsage` reported. After `read` succeeds it calls `callTokens(usage, messages, answer)`: the report as `{ input, output }`, or, with no report, an estimate with `estimated: true`. `estimateTextTokens` counts one token per Chinese, Japanese or Korean character and words × 4/3 for the rest, over all messages for input and the raw answer for output.
- `loggedCall` returns `{ value, tokens }`. A call that fails, is stopped or cannot be parsed returns nothing, so it is never counted.
- `addTokens` sums two counts; the sum is `estimated` if either part was. `readTokens` reads a count from a file and drops it if it is not two finite numbers.
- `formatTokens` gives "1,200 in · 300 out tokens", with "≈" and "estimated" for an estimate, in the UI language.

Where the counts go:

| Count | Saved in | Shown by |
| --- | --- | --- |
| One block version | `BlockVersion.tokens` in `draft.json` | `BlockTokens` under each block in `ChapterWriter` |
| The chapter so far | `Draft.tokens`: every successful block call of the chapter, regenerations included | The action bar (`tokens.chapterSoFar`), not for the epilogue |
| The finished chapter | `tokens` in the chapter's `summary.md` header: `Draft.tokens` plus the End Chapter call, added in `runSummary` | [ChapterReview.tsx](../../src/pages/ChapterReview.tsx) and `ChapterReader` |
| The epilogue | `tokens` in its `summary.md`: `Draft.tokens`, saved by `acceptEpilogue` | `ChapterReader` |

## Errors and Stop

Nothing is written to the draft unless the block arrived and parsed (spec 9, decision 38). Every message below is read with `t()` when it is thrown, so it is in the UI language of that moment; the provider's own words inside it stay as sent (spec 11). The page shows:

| Cause | Thrown | Message comes from |
| --- | --- | --- |
| No key, no model, bad base URL | `AiError` | `loadAiConfig`, `checkConfig`, `streamChat` |
| Network failure before an answer | `AiError` | `NO_CONNECTION` |
| Error status | `AiError` | `explainStatus` (our words; chat 400 and 404 point to the model name, decision 56; 402 or 429 with a quota or billing code is "no credit", decision 58), then the provider's own message from `providerError`, cut to 300 characters |
| Answer not in the expected format | `AiError` | `BAD_FORMAT` |
| Connection drops mid-stream | `AiError` | `BROKE_OFF` |
| Error event inside the stream | `AiError` | "The provider stopped with an error: …" |
| Empty block | `AiError` | `writeBlock`'s `read` |
| Stop pressed, or the page unmounted | `AiStopped` | `ChapterWriter` shows a notice, not an error |
| Ended chapter, blocked next block | `Error` | `writeBlock`; shown as "The block could not be written: …" |

**Stop** calls `abort()` on the controller. The page also aborts when `ChapterWriter` unmounts, which is how leaving the story discards the block (decision 59). `streamChat` turns any failure after an abort into `AiStopped`.

## The epilogue

The epilogue uses the same `writeBlock` with a draft that has `epilogue: true` (decision 52). `emptyDraft` sets that flag when `story.ending` is set. Differences:

- `buildPrompt` gets `epilogue: { mainCharacterDied }`: the system message asks for one closing chapter at the Short length, leaves out the death rule and the action note, and asks for plain prose with no marker; the `chapter` layer is left out; the direction layer is headed `## The epilogue`.
- The answer is still read with `parseBlock` (it has no marker, so `complete` is false and there are no actions).
- `nextBlockBlocked` allows no second block; Regenerate adds versions.
- The action bar appears for the epilogue only while it is being written (decision 88), and shows no token total.
- `acceptEpilogue` in [endChapter.ts](../../src/lib/endChapter.ts) saves it as the last chapter, with no AI call, behind the progress dialog. Its `summary.md` gets the title `"Epilogue"` and the draft's token total.

## The End Chapter call

One AI call per chapter, through the same `loggedCall` and `streamChat` (so it asks for usage too), but not shown while it arrives (decision 51). The page runs it behind [ProgressDialog.tsx](../../src/components/ProgressDialog.tsx); `endChapter` and `summarizeChapter` report each `EndChapterStep` through their `onStep` callback: `saving-chapter` at the start of step 1, `writing-summary` just before the AI call, `saving-summary` once it answered. Stop is offered only during `writing-summary` (decision 88). [endChapter.ts](../../src/lib/endChapter.ts):

1. `endChapter` (step 1) checks the draft (not the epilogue, has blocks, an accepted death is allowed by the setting, decision 62), saves an accepted ending into the draft, writes `chapter.md`, raises `chapterCount`, sets `ending` for a death, and calls `summarizeChapter`. If the `story.json` write fails, `reconcileStory` repairs it later (decision 75).
2. `summarizeChapter` builds the messages with `buildEndChapterPrompt` (with `picture: true` on Lite, which adds a `picture` key for the chapter's key scene, and an `appearance` rule for new characters, decision 145):
   - system: the JSON shape, and rules per key; the story summary cap and the used scenes cap from the budget (`tokensToLength`), with "compress" or "merge" added only when the current summary or list is over its cap; an age always asked for new characters, at least `rules.minAge` (decision 67); openings phrased as actions, not requests (spec 6.5);
   - user: the character field keys and what each accepts (`describeField`, with choice options in the novel's language), **every** character's header (no background, choice values through `localizeChoices`), the story so far, the used scenes, and the full chapter text.
3. `parseEndChapter` takes the text between the first `{` and the last `}`, so code fences and surrounding words are tolerated. It requires `chapter_summary` and `story_summary`; other keys default to empty; `next_openings` is cut to 3.
4. `checkProposals` keeps a change only for a known character (matched by name, case-insensitive) and a known, visible, non-name field whose value, after `choiceToEnglish` (a choice in any of the three languages back to its English option, decision 84), passes `coerce`, `normalize` and `validate` and differs from the file. The old value is read from the file. A new character needs a name that does not exist yet; its fields go through `choiceToEnglish` too; a missing or too low age is set to `rules.defaultAge` with `ageFilled`.
5. The answer is saved at once: `review.json`, `scenes.md` when the answer has scenes, story `summary.md`, and last the chapter `summary.md` (title, summary, openings, on Lite the picture scene, and the chapter's tokens: the draft's total plus this call), which marks the step done (decision 76). On Lite, `drawChapterPicture` then starts without being awaited.

If the call fails, `chapter.md` is already saved and the Novel page shows the summary-pending state with a retry that calls `summarizeChapter` again. Only one call per story runs at a time: `summarizeChapter` refuses a second, and `summaryInFlight` lets a page opened meanwhile wait for the first (decision 77). The page passes an `AbortSignal` that Stop in the progress dialog, or leaving the story, aborts; the chapter then stays in summary-pending.

## The AI call log

In development builds (`import.meta.env.DEV`: `npm run dev`, `npm run tauri dev`, Vitest) `loggedCall` writes one file per call with `writeAiLog` from [devlog.ts](../../src/lib/devlog.ts) (decision 46), whether it succeeded, failed or was stopped:

- name: `<ISO time with : and . replaced by ->-<kind>-<outcome>.md`; kinds are `block`, `block-regenerate`, `epilogue`, `epilogue-regenerate` and `end-chapter`, plus `picture-block` and `picture-chapter` for picture requests (written by `draw` in [pictures.ts](../../src/lib/pictures.ts), with the scene and the prompt but never the picture); outcomes `ok`, `error`, `stopped`;
- content: time, kind, outcome, duration, endpoint, the request body without the messages, the facts passed by the caller (budget, layers, characters in the scene, lengths, direction, hint, and the parse results, with each suggested action's note in brackets), `Tokens` for a call that succeeded, each message exactly as sent in a code fence, then the raw answer or the part that arrived;
- the log is not translated (spec 11);
- the key is never part of the entry; only the newest `AI_LOG_KEEP` (100) files per story are kept; a write failure only logs a console warning.

## Invariants and gotchas

- **The marker, flag, mood and picture lines are a contract** between `instructions` in [prompt.ts](../../src/lib/prompt.ts), `parseBlock` and `visibleText` in [block.ts](../../src/lib/block.ts), and the mock server. Change them together (decision 36).
- **Prompt wording is read by tests and the mock.** The mock server and the unit-test fixtures tell the call kinds apart by the system message (`You are the editor` for End Chapter, `Write the epilogue` for the epilogue), and the mock echoes the `Direction: ` and `Hint for this version: ` lines. See [testing-internals.md](testing-internals.md).
- **`onText` gets the whole text, not a delta.** `visibleText` relies on that.
- **Regenerate sends the blocks without the latest one.** Sending the replaced block would make the AI continue it instead of rewriting it.
- **The story summary is not truncated in the prompt.** Its cap depends on the End Chapter call obeying the instruction.
- **The End Chapter request grows with the story's characters and the chapter's length**, not with the number of chapters: every character header and the whole chapter are sent.
- **Option strings are keys.** `POINT_OF_VIEW`, `CONTENT_RATING` and `DEATH_RULE` in [prompt.ts](../../src/lib/prompt.ts) look up the exact English option text from the story type JSON; an unknown value falls back to a safe default. So do the translations (`option.<key>.<value>`). See [story-types.md](story-types.md).
- **Localize only what is sent.** `localizeChoices` returns a copy for the prompt; files and the values the page holds stay English. Anything the AI writes back must go through `choiceToEnglish` before it is checked or saved, or a Chinese value fails `validate` and the proposal is dropped.
- **The usage chunk has no choices.** The stream handler reads `usage` before it looks at `choices`; a change that skips chunks without choices loses the report and every count becomes an estimate.
- **The log shows the first request body.** `loggedCall` logs `chatBody(model, messages)` with `stream_options`, even when `streamChat` had to retry without it.
- **The answer format and the parser share the separator.** The instructions ask for ` | `; `parseBlock` splits at `|` or `｜` (`NOTE_SEPARATOR`, spaces around it trimmed). A story action that itself contains a bar is cut there.
- **The code comment on `nextBlock` says "Layer 9"**; in spec 6.1 the direction is layer 10 since the used scenes list was added. See [drift.md](drift.md).
