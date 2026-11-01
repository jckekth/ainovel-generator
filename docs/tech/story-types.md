# Story types

Last checked against the code: 2026-11-01

A story type (genre) is a JSON file, not code (decisions 6, 27), plus a file of curated sets (decisions 72, 85) and its texts in the two Chinese translation files (decision 83). This page covers those formats, how the code reads them, and how to add a type. The fields each type must have are in [spec.md](../spec.md) sections 4, 7 and 8.

## Files

| File | Holds |
| --- | --- |
| [src/storyTypes/common.json](../../src/storyTypes/common.json) | Fields every type shares: `setting` (a list) and `character` with `head` and `tail` lists |
| [src/storyTypes/cultivation.json](../../src/storyTypes/cultivation.json), [romance.json](../../src/storyTypes/romance.json), [fantasy.json](../../src/storyTypes/fantasy.json), [general.json](../../src/storyTypes/general.json) | One type each: fields, defaults, rules, prompt lines, picture style |
| [src/storyTypes/sets/cultivation.json](../../src/storyTypes/sets/cultivation.json), [sets/romance.json](../../src/storyTypes/sets/romance.json), [sets/fantasy.json](../../src/storyTypes/sets/fantasy.json) | The type's curated sets: ready-made worlds, each with a main character (appearance included) and a name pool, in three languages. General has none (decision 125): its world is the user's own |
| [src/lib/art.ts](../../src/lib/art.ts), [src/assets/backgrounds/](../../src/assets/backgrounds/) | The type's background, `<id>.webp` (General: `general.svg`), and its strength (spec 12.3) |
| [src/lib/storyTypes.ts](../../src/lib/storyTypes.ts) | Imports the type files (bundled by Vite at build time), the `StoryType` type, the merge functions, the novel languages |
| [src/lib/curatedSets.ts](../../src/lib/curatedSets.ts) | Imports the set files; picks, applies and translates sets |
| [src/lib/fields.ts](../../src/lib/fields.ts) | `FieldDef` and everything done with field values |
| [src/i18n/zh-Hans.ts](../../src/i18n/zh-Hans.ts), [zh-Hant.ts](../../src/i18n/zh-Hant.ts) | `config`: the Chinese labels, hints, placeholders, scale ends, options, section names, type names and descriptions |

The JSON is cast with `as unknown as`, so TypeScript does **not** check the files. [src/test/storyTypes.test.ts](../../src/test/storyTypes.test.ts) and [src/i18n/i18n.test.ts](../../src/i18n/i18n.test.ts) do (see below).

## The type file

Top-level keys, matching the `StoryType` interface:

| Key | Type | Used for |
| --- | --- | --- |
| `id` | string | Stored in `story.json`; fixed for the life of a story. `getStoryType` throws a readable error for an unknown id. Also the key of the type's sets and of `type.<id>.name` in the translations. |
| `name`, `description` | string | New story dialog, through `typeName` and `typeDescription` (Chinese from `config`). The English `name`, lower-cased, is also used in the prompts ("an interactive cultivation novel"). |
| `settingFields` | `FieldDef[]` | The type's Setting page fields, after the common ones |
| `characterFields` | `FieldDef[]` | The type's character fields, between the common `head` and `tail` |
| `settingDefaults` | object, optional | Overrides the `default` of a common setting field, e.g. `{ "tone": ["Hot-blooded"] }` (decision 44) |
| `rules` | `StoryTypeRules` | `mainCharacterRequired` (field keys), `minAge` (optional), `defaultAge` (for AI-proposed characters, decision 67) |
| `prompt` | string[] | The genre's writing instructions, sent as `## Genre` in every block's system message |
| `imageStyle` | string | The art style of every picture in a story of this type, sent first in the picture prompt (spec 14.2, decisions 144, 148) |
| `suggestions` | boolean, optional | `false` for no suggested actions under blocks and no chapter openings, so every block needs the user's direction (General, decisions 125, 126). Read through `hasSuggestions` |
| `worldFirst` | boolean, optional | `true` puts the type's own setting fields before the shared Story fields on the Setting page (General, decision 129) |

The example world and main character are no longer in this file: `defaultBackground` and `mainCharacterDefaults` were replaced by the curated sets (decision 85).

## Field definitions

`FieldDef` in [fields.ts](../../src/lib/fields.ts):

| Key | Meaning |
| --- | --- |
| `key` | YAML header key, snake_case. Must be unique across the merged list. Also the key of the field's texts in the translations (`field.<key>.label`, `option.<key>.<value>`). |
| `label`, `section` | Shown in the form through `fieldLabel` and `sectionName`; fields with the same `section` share a panel, in first-seen order |
| `type` | One of the `FieldType` values below |
| `options` | For `choice` and `multi`. The English text is what files store and code compares; the UI shows `optionLabel` |
| `min`, `max` | For `number` and `scale`; for `multi`, `max` is the most that can be picked |
| `minLabel`, `maxLabel` | Words at the ends of a scale (`scaleLabels`) |
| `default` | Starting value; deep-cloned by `defaultValue` |
| `required` | Must be filled in to save |
| `hideForMain` | Not shown, not saved and not sent for the main character |
| `hint`, `placeholder` | Help text (`fieldHint`, `fieldPlaceholder`) |

All of these texts are written in English in the JSON. For Chinese, `configText` in [i18n/index.ts](../../src/i18n/index.ts) looks up the `config` entry of the locale, and falls back to the English when there is none.

| `FieldType` | Form control in [FieldForm.tsx](../../src/components/FieldForm.tsx) | Value | Default without `default` |
| --- | --- | --- | --- |
| `text` | input | string | `""` |
| `longtext` | textarea | string | `""` |
| `number` | number input; for `age` the lowest value is `rules.minAge` when set | number or `null` | `null` |
| `choice` | buttons when required with 3 options or fewer of 30 characters or fewer; otherwise a select | string | `""` |
| `multi` | chips, limited by `max` | string[] | `[]` |
| `list` | textarea, one item per line (decision 29) | string[] | `[]` |
| `scale` | range | number | midpoint of `min`..`max` (1..5 if unset) |
| `rank` | select from `rankOptions` of the setting's ladder | string such as `"Qi Refining, Early"` | `""` |
| `ladder` | `LadderEditor`; its reset button goes back to the curated set's ladder in the novel's language when there is one, else the field's `default` | `Rank[]` (`{ name, stages[] }`) | `[]` |
| `language` | `LanguagePicker`: the three `LANGUAGES`, plus the story's current value when it is another one from before phase 6 | string | `""` |

## Curated sets

A set file is an array of `CuratedSet` ([curatedSets.ts](../../src/lib/curatedSets.ts)):

```json
{
  "id": "nine-peaks",
  "values": { "tone": ["Hot-blooded"], "world_cruelty": 3 },
  "main": { "gender": "Male", "age": 18, "spiritual_root": "Lightning" },
  "text": {
    "en":      { "values": { "rank_ladder": [...], "sects_and_factions": [...] }, "background": "...",
                 "main": { "name": "...", ... }, "mainBackground": "...", "names": { "male": [...], "female": [...] } },
    "zh-Hans": { ... },
    "zh-Hant": { ... }
  }
}
```

- `values` and `main` hold what is the same in every language: choices (in English, like the files), scales, numbers.
- `text.<locale>` holds what is written in a language: text, lists, the rank ladder, the background, the main character's text fields and background, and the name pool.
- `textLocale(language)` picks the text: the novel's language through `novelLocale`, English for any other.

Where sets are used:

| Moment | Code | What happens |
| --- | --- | --- |
| New story | `createStory` in [stories.ts](../../src/lib/stories.ts) | `randomSet(type)` picks one; its id is saved as `setId` in `story.json` (decision 85) |
| Setting page before the first save | `loadSetting` in [setting.ts](../../src/lib/setting.ts) | Field defaults, then `setValues(set, story.language)`, then the language; the background is `setBackground` |
| Randomize | `randomize` in [SettingTab.tsx](../../src/pages/SettingTab.tsx) | `randomSet(type, current)` never returns the set shown when there is another; `applySet` replaces only the set's fields and the background. The new `setId` reaches `story.json` only when the setting is saved (`saveSetting`). |
| The novel's language changes on the Setting page | `change` in SettingTab.tsx | `switchSetLanguage` swaps each field (and the background) that still equals the set's text in the old language for the new one; anything the user typed stays |
| New main character | `exampleMainCharacter` in [characters.ts](../../src/lib/characters.ts), passed to `newCharacter` | The story's set's main character in the story's language. `newCharacter` alone falls back to the type's first set in English. |
| "Use the setting's main character" | `useSetMain` in [CharactersTab.tsx](../../src/pages/CharactersTab.tsx) | Fills the set's main character over the form (main character only) |
| Random name | `pickName` in CharactersTab.tsx | `randomName`: a name from the pool for the chosen gender (both pools for any other gender or none), not used by another character or the current one; `null` when all are used, which shows a note |

A story from before sets has no `setId`; `getSet` then returns the type's first set, so Randomize, the name pool and the main character still work.

## How fields are merged and read

- `settingFields(type)`: the common `setting` list, with `settingDefaults` applied, then `type.settingFields`.
- `characterFields(type)`: common `head`, then `type.characterFields`, then common `tail` (so status, location and condition come last).

Values go through four steps in [fields.ts](../../src/lib/fields.ts), whatever their source (a file, the form, a curated set, or the AI at End Chapter):

1. `valuesFromHeader` / `coerce`: from a YAML header into the shape the form expects; junk falls back to the default, unknown keys go to `extra`.
2. `normalize`: trims text, drops empty list lines and nameless ranks, turns a non-finite number into `null`.
3. `validate`: required, `minAge` for `age` (always checked when the type sets it), whole numbers and `min`/`max`, `multi` limit, a `rank` that is in the ladder, a `choice` that is one of the options. Hidden keys are skipped. Messages name the field with `fieldLabel`.
4. `headerFromValues`: back to a header in field order, then `extra`.

Choice values in other languages (decision 84):

- `localizeChoices(fields, values, locale)` turns every `choice` and `multi` value into `optionLabel` in the locale; used for the setting and character files sent to the AI ([prompt.ts](../../src/lib/prompt.ts)) and for the character headers in the End Chapter call.
- `choiceToEnglish(field, raw)` turns a value written in any of the three languages back to the English option with `optionValue`; used by `checkProposals` before `coerce`. Unknown text stays as it is and then fails `validate`.

Who fills which context:

| Caller | `required` | `hidden` | `rankOptions` |
| --- | --- | --- | --- |
| Setting page ([SettingTab.tsx](../../src/pages/SettingTab.tsx)) | fields with `required` | none | from the ladder being edited |
| Character form ([CharactersTab.tsx](../../src/pages/CharactersTab.tsx)) | `requiredKeys`: `required` fields, `mainCharacterRequired` for the main character, `age` when `minAge` is set | `hiddenKeys` | from the saved setting's `rank_ladder` |
| `checkProposals` ([endChapter.ts](../../src/lib/endChapter.ts)) | none, so a list can be emptied | none (hidden fields are dropped before) | from the saved setting |
| `approveProposal` for a new character | `requiredKeys` for a non-main character | `hiddenKeys` | from the saved setting |

## Keys and options the code knows by name

Most fields are generic: they are shown, saved and sent to the AI without code knowing them. These are not. Renaming one in the JSON breaks the code silently.

| Key | Options used by name | Where |
| --- | --- | --- |
| `language` | The three `NOVEL_LANGUAGES` strings; Chinese and Japanese counted in characters (`countsCharacters`) | [setting.ts](../../src/lib/setting.ts), [prompt.ts](../../src/lib/prompt.ts), [length.ts](../../src/lib/length.ts), [languageStyle.ts](../../src/lib/languageStyle.ts) (notes keyed by the exact strings), `novelLocale` in [i18n/index.ts](../../src/i18n/index.ts) (by pattern) |
| `point_of_view` | the three options | `POINT_OF_VIEW` in prompt.ts (sent as an English sentence) |
| `content_rating` | `General`, `Mature` | `CONTENT_RATING` in prompt.ts (English sentence) |
| `main_character_death` | `Never`, `Only when I direct it`, `The AI may decide` | `DEATH_RULE` in prompt.ts; `deathCanBeAccepted` in [novel.ts](../../src/lib/novel.ts) checks `Never` |
| `chapter_length` | `Short`, `Medium`, `Long` | `TARGETS` in length.ts; the epilogue always uses `Short` |
| `story_length` | `Short story`, `Long story`, `Continuous` | `PLANNED`, `storyLengthRule`, `storyArcStage` in length.ts |
| `tone`, `narration_detail` | any | prompt.ts sends them in the novel's language (`settingChoice`) |
| `rank_ladder` | | `ladderOf` in setting.ts: the only key a `rank` field reads its options from |
| `name` | | Character ids, `characterName`, name matching, proposals, `hasAppeared`, the Random name button (`extras.name` in CharactersTab.tsx) |
| `gender` | `Male`, `Female` | `randomName` picks the pool |
| `age` | | `validate` with `minAge`; `checkProposals` default age |
| `status` | `Inactive`, `Alive` | `charactersInScene` leaves out `Inactive`; the character card styles anything not `Alive` |
| `relationship`, `cultivation_rank`, `occupation` | | The one-line summary on character cards (`summaryLine`) |

`main_character` is a reserved header key in character files ([characters.ts](../../src/lib/characters.ts)); do not use it as a field key.

## The contract tests

[src/test/storyTypes.test.ts](../../src/test/storyTypes.test.ts) runs for every entry of `STORY_TYPES` (`describe.each`). It checks, among others: unique snake_case keys, known field types, options for `choice` and `multi` with defaults among them, scale defaults within range, no required field hidden for the main character, `mainCharacterRequired` keys that exist, a `defaultAge` allowed by the age field and `minAge`, and a default for every setting field except the language. For the curated sets of each type: at least three, unique ids, the same keys and name pool sizes in every language, an English background over 100 characters and at least five names per pool, a setting and main character that pass `validate` in each of the three languages, and no repeated name or the main character's name in a pool. Type-specific spec rules (romance `minAge` 18, cultivation's required `special_ability` and default ladder) are in "rules from the spec".

[src/i18n/i18n.test.ts](../../src/i18n/i18n.test.ts) checks that every type name and description, every field label, hint, placeholder, scale end, option and section name has a `zh-Hans` and a `zh-Hant` entry, and that every option reads back to its English value from each language. The full list is in [testing.md](../testing.md) section 3 (C-CFG).

## Adding a story type

1. Write its spec section (fields and rules) and a decision row first ([docs/README.md](../README.md) workflow).
2. Add `src/storyTypes/<id>.json` with every key above. Give every setting field a default, and write `rules.defaultAge` and the `prompt` lines.
3. Import it in [storyTypes.ts](../../src/lib/storyTypes.ts) and add it to `STORY_TYPES`. The order of that array is the order in the New story dialog; the first entry is preselected.
4. Add `src/storyTypes/sets/<id>.json` with at least three sets, each in `en`, `zh-Hans` and `zh-Hant`, with an `appearance` for each main character, and add it to `SETS` in [curatedSets.ts](../../src/lib/curatedSets.ts). A type with no sets (like General) must be left out of `WITH_SETS` in the contract tests.
5. Add its background as `src/assets/backgrounds/<id>.webp` and pass the contrast check of spec 12.3 (lower its strength in [art.ts](../../src/lib/art.ts) if needed), give it an emblem in [TypeEmblem.tsx](../../src/components/TypeEmblem.tsx), and write its `imageStyle`.
6. Add the type's texts to `config` in both [zh-Hans.ts](../../src/i18n/zh-Hans.ts) and [zh-Hant.ts](../../src/i18n/zh-Hant.ts): `type.<id>.name`, `type.<id>.description`, and `field.…`, `option.…`, `section.…` for every new field.
7. Run `npm test`. The contract and translation tests pick up the new type and list what is missing; add its own spec rules to `storyTypes.test.ts`.
8. If it uses ranks, name its ladder field `rank_ladder`. If its characters need a line on the character card, extend `summaryLine` in [CharactersTab.tsx](../../src/pages/CharactersTab.tsx).

Nothing else needs to change: the forms, the prompt and the End Chapter call are built from the merged field lists.

**Appearance.** `appearance` is a common character field (in `common.json`, decision 145), so every type has it. It feeds the picture prompt for any character the scene names, and the End Chapter call proposes one for new characters.

## Gotchas

- **Option text is data, a key and a translation key at once.** The English strings are stored in files, compared in code, and looked up as `option.<key>.<English value>` in the translations. Changing the wording needs a migration for old files and new translation keys, or old stories fall back to defaults (an unknown point of view becomes third person) and the UI shows the raw English.
- **Two translations must not collide.** `optionValue` takes the first option whose Chinese label matches; two options of one field with the same label in a language cannot be told apart when the AI writes them back.
- **`settingDefaults` only overrides common fields**; a type's own fields carry their `default` inline. A curated set then overrides both for the fields it covers.
- **The language swap compares exact values.** `switchSetLanguage` compares each field with `JSON.stringify` against the set's text in the old language, so set text should already be in the shape `normalize` leaves it (trimmed, no empty lines), or a saved and reloaded field stops matching.
- **`LANGUAGES` is in [storyTypes.ts](../../src/lib/storyTypes.ts)**, not in the JSON: the three of decision 71. `novelLocale` recognises them by pattern, and [languageStyle.ts](../../src/lib/languageStyle.ts) by the exact strings; renaming one needs both.
