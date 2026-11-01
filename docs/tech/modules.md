# Modules

Last checked against the code: 2026-11-01

Every file in [src/lib/](../../src/lib/) and [src/i18n/](../../src/i18n/): its job, its main exports, what it imports from the rest of `src/lib` and `src/i18n`, and its tests. The pages and components that use them are listed at the end. How the layers fit together is in [architecture.md](architecture.md).

## Translations

| File | Job | Main exports | Depends on | Tests |
| --- | --- | --- | --- | --- |
| [i18n/index.ts](../../src/i18n/index.ts) | The current UI language and `t()`; story type texts by field key; choice values between English and the other two languages; the novel's language as a locale (spec 11, decisions 83, 84) | `Locale`, `LOCALES`, `LOCALE_NAMES`, `MessageKey`, `Messages`, `setLocale`, `getLocale`, `isLocale`, `t`, `tIn`, `tCount`, `detectLocale`, `novelLocale`, `fieldLabel`, `fieldHint`, `fieldPlaceholder`, `scaleLabels`, `sectionName`, `optionLabel`, `optionValue`, `typeName`, `typeDescription`, `hasConfigText` | en, zh-Hans, zh-Hant; `FieldDef` type from fields | [i18n.test.ts](../../src/i18n/i18n.test.ts) |
| [i18n/en.ts](../../src/i18n/en.ts) | English UI texts, grouped by page; the source whose keys type the other files | default export (the `MessageKey` source) | none | i18n.test.ts |
| [i18n/zh-Hans.ts](../../src/i18n/zh-Hans.ts), [i18n/zh-Hant.ts](../../src/i18n/zh-Hant.ts) | The same keys in Simplified and Traditional Chinese, typed as `Messages`; plus `config`, the story type texts (`type.<id>.name`, `field.<key>.label`, `option.<key>.<English value>`, `section.<name>`, …) | default export, `config` | index (type) | i18n.test.ts: every key with the same placeholders, written in Chinese, no Traditional characters in the Simplified file, and every story type text translated |
| [i18n/rich.tsx](../../src/i18n/rich.tsx) | `tRich`: a text whose placeholders are React elements, such as a bold title, wherever each language puts them | `tRich` | index | none |

How `t()` works:

- `t(key, params)` reads the module-level locale set by `setLocale`; `tIn(locale, …)` reads any. A missing key falls back to English, then to the key itself. `{name}` placeholders are filled; numbers are grouped (`1,200`).
- `tCount(key, count)` uses `<key>.one` when the count is 1 and that key exists. `Messages` requires every English key, so the Chinese files carry the `.one` keys too, usually with the same wording.
- Config texts (`fieldLabel`, `optionLabel`, …) return the English from the JSON for `en`, and the `config` entry, or the English when there is none, for the Chinese locales.
- `optionValue(field, text)` is the reverse of `optionLabel`: it finds the English option for a value written in any of the three languages (case-insensitive for English), and returns unknown text unchanged.
- `novelLocale(language)` maps a novel language to a locale by pattern (`English`, `简体`/`Simplified`, `繁體`/`Traditional`); any other language (Japanese, Korean, Malay from before phase 6) gives `null`.

## Platform and storage

| File | Job | Main exports | Depends on | Tests |
| --- | --- | --- | --- | --- |
| [platform.ts](../../src/lib/platform.ts) | Detects the Tauri shell; opens a folder in the file explorer or a link in the browser; reports when the window is hidden or minimised | `isTauri`, `onWindowHidden`, `openFolder`, `openLink` | none | none (Tauri-only branch; manual checks) |
| [storage.ts](../../src/lib/storage.ts) | One file interface (text and bytes) with two implementations: real files in the data folder `ainovelgenerator` (decision 154), localStorage in the browser | `FileStore`, `DirEntry`, `DATA_FOLDER`, `store`, `readJson`, `writeJson`, `bytesToBase64`, `base64ToBytes` | platform | [storage.test.ts](../../src/lib/storage.test.ts) (browser store) |
| [secrets.ts](../../src/lib/secrets.ts) | The text and image API keys: OS credential store through Rust commands, or sessionStorage in the preview | `getApiKey`, `setApiKey`, `deleteApiKey`, `getImageKey`, `setImageKey`, `deleteImageKey` | platform | [settings.test.ts](../../src/lib/settings.test.ts) (browser branch) |
| [settings.ts](../../src/lib/settings.ts) | Global settings in `app-settings.json`, the UI language included; applies theme and font size | `AppSettings`, `ContextBudget`, `Theme`, `ImageLevel`, `ImageQuality`, `DEFAULT_SETTINGS`, `loadSettings`, `saveSettings`, `applyAppearance`, `FONT_SIZE_MIN`, `FONT_SIZE_MAX` | i18n (`detectLocale`, `isLocale`), storage | [settings.test.ts](../../src/lib/settings.test.ts) |
| [art.ts](../../src/lib/art.ts) | The story art files: a background per type and the three shared figures, found with `import.meta.glob`; a missing file gives `undefined` (spec 12.3) | `backgroundUrl`, `backgroundStrength`, `figureKind`, `figureUrl` | none | [storyTypes.test.ts](../../src/test/storyTypes.test.ts) |
| [errors.ts](../../src/lib/errors.ts) | Turns system errors (read-only folder, full disk, full browser storage, missing file) into plain words; passes an `AiError` through unchanged | `errorText` | i18n, ai | [errors.test.ts](../../src/lib/errors.test.ts) |
| [devlog.ts](../../src/lib/devlog.ts) | Development builds only: writes each AI call as markdown in `ai-log/`, keeps the newest 100 | `AI_LOG_ENABLED`, `AI_LOG_KEEP`, `aiLogDir`, `AiLogEntry`, `formatAiLog`, `aiLogFileName`, `writeAiLog` | ai (type), storage, stories | [devlog.test.ts](../../src/lib/devlog.test.ts) |

## Stories, setting and characters

| File | Job | Main exports | Depends on | Tests |
| --- | --- | --- | --- | --- |
| [stories.ts](../../src/lib/stories.ts) | Story folders and `story.json`: create (with a random curated set), list in bookshelf order, get, update, mark opened, delete; folder-safe ids | `Story`, `StoryStatus`, `StoryEnding`, `NewStory`, `storyDir`, `makeId`, `listStories`, `getStory`, `createStory`, `updateStory`, `markOpened`, `deleteStory` | curatedSets, storage | [stories.test.ts](../../src/lib/stories.test.ts) |
| [storyTypes.ts](../../src/lib/storyTypes.ts) | Loads the story type JSON files and merges the common fields; the three novel languages | `StoryType`, `StoryTypeRules`, `STORY_TYPES`, `hasSuggestions`, `getStoryType`, `storyTypeName`, `settingFields`, `characterFields`, `NOVEL_LANGUAGES`, `LANGUAGES` | i18n, fields (type), `src/storyTypes/*.json` | [src/test/storyTypes.test.ts](../../src/test/storyTypes.test.ts) |
| [curatedSets.ts](../../src/lib/curatedSets.ts) | Curated sets: pick one, fill a setting or main character from it in the novel's language, swap its text when the language changes, pick a free name (spec 4, 7.1, 8; decisions 72, 85) | `CuratedSet`, `SetText`, `setsOf`, `getSet`, `randomSet`, `textLocale`, `setValues`, `setBackground`, `setMainCharacter`, `applySet`, `switchSetLanguage`, `randomName` | i18n (`novelLocale`), fields (type), `src/storyTypes/sets/*.json` | [curatedSets.test.ts](../../src/lib/curatedSets.test.ts), [storyTypes.test.ts](../../src/test/storyTypes.test.ts) (every set valid in every language) |
| [fields.ts](../../src/lib/fields.ts) | Field definitions and values: defaults, reading from YAML (`coerce`), tidying (`normalize`), header building, validation; choice values to and from the novel's language | `FieldType`, `FieldDef`, `Rank`, `Values`, `defaultValue`, `defaultValues`, `coerce`, `normalize`, `localizeChoices`, `choiceToEnglish`, `rankOptions`, `valuesFromHeader`, `headerFromValues`, `validate`, `ValidationContext` | i18n (`fieldLabel`, `optionLabel`, `optionValue`, `t`) | [fields.test.ts](../../src/lib/fields.test.ts) |
| [markdoc.ts](../../src/lib/markdoc.ts) | Markdown files with a YAML header: parse and format (decision 28) | `MarkDoc`, `parseMarkDoc`, `formatMarkDoc` | i18n, `yaml` package | [markdoc.test.ts](../../src/lib/markdoc.test.ts) |
| [setting.ts](../../src/lib/setting.ts) | `setting.md` and `notes.md`; a new setting from the story's curated set; the setting lock | `SettingDoc`, `loadSetting`, `saveSetting`, `ladderOf`, `isSettingLocked`, `loadNotes`, `saveNotes` | curatedSets, markdoc, fields, storage, stories, storyTypes | [setting.test.ts](../../src/lib/setting.test.ts) |
| [characters.ts](../../src/lib/characters.ts) | Character files; main character rules and the set's example main character; delete rules; story readiness | `Character`, `CharacterList`, `newCharacter`, `exampleMainCharacter`, `characterName`, `hiddenKeys`, `requiredKeys`, `listCharacters`, `saveCharacter`, `hasAppeared`, `deleteCharacter`, `StoryReadiness`, `getReadiness` | i18n, curatedSets, markdoc, fields, storage, stories, storyTypes | [characters.test.ts](../../src/lib/characters.test.ts) |

## Writing the novel

| File | Job | Main exports | Depends on | Tests |
| --- | --- | --- | --- | --- |
| [ai.ts](../../src/lib/ai.ts) | OpenAI-compatible calls: list models, streamed chat with the usage report, one picture from the images API; plain-words errors; SSE decoding | `AiConfig`, `ChatMessage`, `AiError`, `AiStopped`, `explainStatus`, `providerError`, `providerMessage`, `listModels`, `SseDecoder`, `Usage`, `readUsage`, `ChatRequest`, `chatBody`, `streamChat`, `PictureRefused`, `ImageRequest`, `imageBody`, `generateImage` | i18n, platform, storage (`base64ToBytes`) | [ai.test.ts](../../src/lib/ai.test.ts) |
| [tokens.ts](../../src/lib/tokens.ts) | Tokens a call used: the provider's report or an estimate; adding, reading from files, formatting (spec 6.6, decision 87) | `Tokens`, `estimateTextTokens`, `callTokens`, `addTokens`, `readTokens`, `formatTokens` | i18n, ai (types) | [tokens.test.ts](../../src/lib/tokens.test.ts) |
| [prompt.ts](../../src/lib/prompt.ts) | Builds the messages for a block or the epilogue from capped layers, with choice values in the novel's language (spec 6) | `Budget`, `BUDGETS`, `LayerId`, `PromptInput`, `Prompt`, `PICTURE_RULE`, `buildPrompt` | ai (type), block, characters, fields, i18n, length, markdoc, languageStyle, mood, scene, setting (type), settings (type), storyTypes | [prompt.test.ts](../../src/lib/prompt.test.ts), [languageStyle.test.ts](../../src/lib/languageStyle.test.ts) |
| [languageStyle.ts](../../src/lib/languageStyle.ts) | Native-prose notes for languages other than English (spec 6.5) | `languageStyle` | none | [languageStyle.test.ts](../../src/lib/languageStyle.test.ts) |
| [scene.ts](../../src/lib/scene.ts) | Which characters are in the scene: name matching (spec 6.1, decision 40) | `mentions`, `charactersInScene` | characters (type) | [scene.test.ts](../../src/lib/scene.test.ts) |
| [block.ts](../../src/lib/block.ts) | Splits an AI answer into story text, actions with their notes, the died flag, the mood and the picture scene; what to show while streaming | `NEXT_MARKER`, `MAX_ACTIONS`, `ParsedBlock`, `parseBlock`, `visibleText`, `stripFlagLines`, `stripSuggestions`, `hasMarker` | mood | [block.test.ts](../../src/lib/block.test.ts) |
| [length.ts](../../src/lib/length.ts) | Word and character counts, chapter limits, token estimates for caps, story length pacing | `countsCharacters`, `countWords`, `chapterLimits`, `chapterStage`, `chapterProgress`, `tailText`, `estimateTokens`, `tokensToLength`, `STORY_LENGTHS`, `VOLUME_CHAPTERS`, `plannedChapters`, `storyLengthRule`, `storyArcStage`, `finaleReached` | none | [length.test.ts](../../src/lib/length.test.ts) |
| [draft.ts](../../src/lib/draft.ts) | The chapter in progress (`draft/draft.json`): load, save, and pure functions that add blocks and versions and keep the chapter's token total | `Draft`, `DraftBlock`, `BlockVersion`, `draftPath`, `emptyDraft`, `loadDraft`, `saveDraft`, `deleteDraft`, `chosenVersion`, `chapterTexts`, `appendBlock`, `addVersion`, `chooseVersion` | i18n, block, mood, storage, stories, tokens | [draft.test.ts](../../src/lib/draft.test.ts) |
| [novel.ts](../../src/lib/novel.ts) | Writes one block or the epilogue: gather files, build prompt, stream, parse, save; the logged AI call, which also returns the tokens, used by End Chapter too | `loadAiConfig`, `loggedCall`, `LoggedCall`, `deathCanBeAccepted`, `nextBlockBlocked`, `WriteBlockOptions`, `writeBlock` | i18n, ai, block, chapters, characters, devlog, draft, fields, length, prompt, secrets, setting, settings, stories, storyTypes, tokens | [novel.test.ts](../../src/lib/novel.test.ts) |
| [unsent.ts](../../src/lib/unsent.ts) | Typed but unsent direction and hint per story, in memory (decision 59) | `Unsent`, `getUnsent`, `setUnsent` | none | [unsent.test.ts](../../src/lib/unsent.test.ts) |

## Music and pictures

How they fit together: [music-and-pictures.md](music-and-pictures.md).

| File | Job | Main exports | Depends on | Tests |
| --- | --- | --- | --- | --- |
| [mood.ts](../../src/lib/mood.ts) | The six moods and what each is for (spec 13.1) | `MOODS`, `Mood`, `MOOD_MEANINGS`, `isMood`, `readMood` | none | [block.test.ts](../../src/lib/block.test.ts), [music.test.ts](../../src/lib/music.test.ts) |
| [music.ts](../../src/lib/music.ts) | The one Web Audio player: fade in, play once, crossfade, pause and resume, levels (spec 13, decisions 131, 132, 149) | `music`, `FADE`, `musicStep`, `dbToGain`, `trackUrl`, `MusicState` | mood, [music.config.ts](../../src/music.config.ts), `src/assets/music/*.mp3` | [music.test.ts](../../src/lib/music.test.ts) (the pure parts; jsdom has no Web Audio) |
| [pictures.ts](../../src/lib/pictures.ts) | Picture prompt, prices, image config, drawing in the background with its state, file places, keeping pictures at End Chapter, picture URLs (spec 14) | `picturePrompt`, `pictureCost`, `costText`, `loadImageConfig`, `PictureState`, `pictureState`, `subscribePictures`, `drawBlockPicture`, `drawChapterPicture`, `blockPicturePath`, `chapterPicturePath`, `keepChapterPictures`, `readChapterPictures`, `pictureUrl`, `sceneFromText`, `SCENE_FROM_TEXT_CHARS` | i18n, ai, chapters, characters, devlog, draft, errors, scene, secrets, settings, storage, stories, storyTypes, [images.config.ts](../../src/images.config.ts) | [pictures.test.ts](../../src/lib/pictures.test.ts) |

## Chapters and the ending

| File | Job | Main exports | Depends on | Tests |
| --- | --- | --- | --- | --- |
| [chapters.ts](../../src/lib/chapters.ts) | Finished chapter folders: text, summary with title, openings and tokens, story summary, used scenes, snapshots, and the context earlier chapters give the prompt | `chaptersDir`, `chapterDir`, `ChapterInfo`, `ChapterSummary`, `defaultTitle`, `chapterEnded`, `saveChapterText`, `readChapterText`, `readChapterSummary`, `saveChapterSummary`, `renameChapter`, `listChapters`, `readStorySummary`, `saveStorySummary`, `readUsedScenes`, `saveUsedScenes`, `snapshotChapter`, `StoryContext`, `loadStoryContext` | i18n, block, markdoc, storage, stories, tokens | [chapters.test.ts](../../src/lib/chapters.test.ts) |
| [endChapter.ts](../../src/lib/endChapter.ts) | End Chapter steps 1–4 with progress steps, the review of proposals, repairing `story.json`, where the Novel page stands, End story and the epilogue | `endChapter`, `EndChapterStep`, `summarizeChapter`, `summaryInFlight`, `reconcileStory`, `buildEndChapterPrompt`, `parseEndChapter`, `checkProposals`, `approveProposal`, `rejectProposal`, `markAccepted`, `newCharacterFrom`, `finishChapter`, `loadReview`, `reviewDone`, `formatValue`, `NovelState`, `loadNovelState`, `endStory`, `acceptEpilogue`, types `Review`, `Proposal`, `ChangeProposal`, `NewCharacterProposal`, `ProposalStatus`, `EndChapterAnswer`, `EndChapterPromptInput` | i18n, ai, chapters, characters, draft, fields, length, markdoc, novel, pictures, prompt, setting, stories, storyTypes, storage, tokens | [endChapter.test.ts](../../src/lib/endChapter.test.ts) |

## Import order

The modules form layers with no import cycles at run time. Leaves first:

1. No `src/lib` imports: `platform`, `mood`, `art`, `length`, `languageStyle`, `unsent`; then `block` and `music` (mood only).
2. `src/i18n` (its only `src/lib` import is the `FieldDef` type, erased at build time); then `fields`, `markdoc` (i18n).
3. `storage`, `secrets` (platform); `ai` (platform, storage, i18n); `tokens` (ai types); `errors` (ai); `storyTypes` (fields, i18n); `curatedSets` (i18n).
4. `stories` (storage, curatedSets), `settings` (storage, i18n).
5. `setting`, `characters`, `draft`, `chapters`, `devlog`, `scene`.
6. `prompt`; `pictures`.
7. `novel`.
8. `endChapter` (imports `novel` for `loggedCall`, `loadAiConfig` and `deathCanBeAccepted`, `prompt` for `BUDGETS`, and `pictures` to draw and keep chapter pictures).

Keep it that way: `novel.ts` must not import `endChapter.ts`, `pictures.ts` must not import `novel.ts` or `endChapter.ts`, and `src/i18n` must import nothing from `src/lib` but types.

## Pages and components

| File | What it is | Main `src/lib` and `src/i18n` calls |
| --- | --- | --- |
| [App.tsx](../../src/App.tsx) | Shell: top navigation bar (Stories, Settings, About), view state, leave guard, UI language, the book opening, music on/off and volume, pausing music when the window is hidden | `loadSettings`, `setLocale`, `applyAppearance`, `saveSettings`, `getApiKey`, `listStories`, `music.configure`, `music.setHidden`, `onWindowHidden` |
| [StoryList.tsx](../../src/pages/StoryList.tsx) | Bookshelf (`Book`, spine titles, the book menu with Delete), New story and Delete dialogs; the novel language starts as the UI language | `listStories`, `createStory`, `deleteStory`, `STORY_TYPES`, `NOVEL_LANGUAGES`, `LANGUAGES`, `getLocale`, `typeName`, `typeDescription` |
| [StoryWorkspace.tsx](../../src/pages/StoryWorkspace.tsx) | One story: background art, header, three tabs kept mounted, leave question; tells the music player a story is open | `markOpened`, `getStory`, `getReadiness`, `storyTypeName`, `music.enterStory`, `music.leaveStory` |
| [NovelTab.tsx](../../src/pages/NovelTab.tsx) | Readiness checklist; `Novel` (state, progress dialog); `ChapterList` (the side list that folds into a Chapters button below 1100 px); `ChapterWriter` (blocks, token counts, action notes, action bar); `ChapterReader` (previous and next links, chapter pictures); music after each block and at End Chapter; block pictures on Rich | `reconcileStory`, `music.blockFinished`, `music.endChapter`, `drawBlockPicture`, `drawChapterPicture`, `readChapterPictures`, `loadNovelState`, `summaryInFlight`, `writeBlock`, `nextBlockBlocked`, `deathCanBeAccepted`, `chooseVersion`, `saveDraft`, `endChapter`, `summarizeChapter`, `endStory`, `acceptEpilogue`, `formatTokens`, `getUnsent`, `setUnsent` |
| [ChapterReview.tsx](../../src/pages/ChapterReview.tsx) | End Chapter steps 3–4: title, the chapter's tokens, the Lite picture, proposals, Finish | `renameChapter`, `approveProposal`, `rejectProposal`, `markAccepted`, `finishChapter`, `formatValue`, `formatTokens`, `fieldLabel` |
| [CharactersTab.tsx](../../src/pages/CharactersTab.tsx) | Character list and `CharacterForm` (also used by the review's "Edit first"), with Random name and the set's main character | `listCharacters`, `newCharacter`, `exampleMainCharacter`, `saveCharacter`, `deleteCharacter`, `validate`, `getSet`, `randomName` |
| [SettingTab.tsx](../../src/pages/SettingTab.tsx) | Setting form with the lock, Randomize and the language swap, and the pinned notes panel | `loadSetting`, `saveSetting`, `isSettingLocked`, `loadNotes`, `saveNotes`, `getSet`, `randomSet`, `applySet`, `setValues`, `switchSetLanguage` |
| [Settings.tsx](../../src/pages/Settings.tsx) | Global settings: key, base URL, model, test connection, budget, appearance (UI language, background art), sound (music, volume), pictures (level, cost, image provider and key, Test image connection), data folder | `setApiKey`, `deleteApiKey`, `setImageKey`, `deleteImageKey`, `listModels`, `costText`, `loadImageConfig`, `store.rootPath`, `openFolder`, `LOCALES`, `LOCALE_NAMES` |
| [FieldForm.tsx](../../src/components/FieldForm.tsx) | Builds a form from `FieldDef[]`, one panel per section, texts in the UI language; `LanguagePicker` for the novel's language | `fieldLabel`, `fieldHint`, `fieldPlaceholder`, `optionLabel`, `scaleLabels`, `sectionName`, `LANGUAGES` |
| [Modal.tsx](../../src/components/Modal.tsx) | Dialog with Escape and click-outside to close | none |
| [useDialogFocus.ts](../../src/components/useDialogFocus.ts) | Keeps keyboard focus inside an open dialog and gives it back on close (CR6-06) | none |
| [Picture.tsx](../../src/components/Picture.tsx) | One picture place: the picture, Drawing…, the failure with Try again, or Make picture; `useImageLevel` | `pictureState`, `subscribePictures`, `pictureUrl`, `loadSettings` |
| [ProgressDialog.tsx](../../src/components/ProgressDialog.tsx) | Dialog that cannot be closed: title, spinner, current step, optional note and Stop (decision 88) | `t` |
| [SetupGuide.tsx](../../src/components/SetupGuide.tsx) | The provider setup guide opened from Settings (decisions 81, 82) | `openLink`, `errorText`, `t` |
| [About.tsx](../../src/pages/About.tsx) | About page: version, author, email with Copy, home page, credits (spec 10); values in [about.config.ts](../../src/about.config.ts) | `openLink`, `t` |
| [StoryArt.tsx](../../src/components/StoryArt.tsx), [CharacterFigure.tsx](../../src/components/CharacterFigure.tsx) | The type's background behind a story and the character's figure behind the sheet (spec 12.3) | `backgroundUrl`, `backgroundStrength`, `figureUrl`, `figureKind` |
| [BookOpening.tsx](../../src/components/BookOpening.tsx) | The book that opens when a story is entered; not shown with reduced motion (spec 12.4) | `getStory` |
| [TypeEmblem.tsx](../../src/components/TypeEmblem.tsx) | Each story type's emblem (decision 96) | none |

## Gotchas

- **Two `BUDGETS`.** [prompt.ts](../../src/lib/prompt.ts) `BUDGETS` holds the caps; [Settings.tsx](../../src/pages/Settings.tsx) has its own `BUDGETS` list with the labels shown to the user. A new budget level needs both, plus the `ContextBudget` type in [settings.ts](../../src/lib/settings.ts) and its texts in the three translation files.
- **A new UI text needs three entries.** Add the key to [en.ts](../../src/i18n/en.ts) first; the type check then fails until both Chinese files have it, and [i18n.test.ts](../../src/i18n/i18n.test.ts) checks the placeholders match. A new story type label, hint or option needs a `config` entry in both Chinese files; the test lists any that are missing.
- **Two token estimates.** `estimateTokens` in [length.ts](../../src/lib/length.ts) counts by the novel's language and is used for caps; `estimateTextTokens` in [tokens.ts](../../src/lib/tokens.ts) counts each character of mixed text and is used only when a provider sends no usage report.
- **`isSettingLocked` reads `draft.json` itself** instead of using [draft.ts](../../src/lib/draft.ts), so `blocks` must stay a top-level array in the draft file (comment at the top of `draft.ts`).
- **`errorText` passes `AiError` through.** Its system-error patterns (for example `quota`) would otherwise match words in a provider's message; `ChapterWriter.run` shows `AiError` messages directly too.
- **`loggedCall` lives in `novel.ts`** but is shared by the End Chapter call; changing its signature (it returns `{ value, tokens }`) touches both.
