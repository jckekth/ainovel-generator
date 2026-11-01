# Phase 7b: General story type

**Status:** Done
**Spec sections:** 4, 5.1, 5.4, 7.7, 8.6, 12.2, 12.3 (decisions 125–129)

## Goal

A fourth story type for any genre the others do not cover. It has the fewest fields, relies on what the user writes, and the AI writes only what the user directs.

## Tasks

- [x] `src/storyTypes/general.json`: the five setting fields and one character field (spec 7.7, 8.6), empty defaults with hints and placeholder examples, prompt fragments that follow the user's genre and style and rules of this world (decision 128)
- [x] A story type setting for suggestions (spec 4, decision 125); off for General: the block prompt asks for no suggested actions, and the End Chapter prompt for no openings
- [x] Direction required for every block in a type without suggestions; Write stays off until the box has text (spec 5.1, decision 126)
- [x] No curated sets, Randomize, name pool or example main character for General; the Setting and Characters pages and story creation work without them
- [x] Abstract ink-wash background `src/assets/backgrounds/general.svg`, passing the contrast check in both themes; quill emblem and its own shade of gray on the bookshelf (spec 12.2, 12.3, decision 127)
- [x] Translations in English, 简体中文 and 繁體中文, the type named 通用
- [x] Mock AI server: a block answer with no suggestions; an End Chapter answer with no openings
- [x] Unit, config contract and E2E tests

## Acceptance checks

- [x] A General story can be created by filling in the genre and style, the world and the main character's name, and written to the end with the user's own directions.
- [x] No suggested actions are shown under any block and no openings on the Start chapter screen; Write is off while the direction is empty, also for the first block of a chapter.
- [x] The AI keeps to the genre and style and the rules of this world over a full chapter.
- [x] The General background and quill emblem fit the look of the other types, and text over the background reads easily in both themes.
- [x] The other three types still offer suggestions and openings as before.

## How to check

Run `npm run mock-ai` and use the mock keys (docs/testing.md).

1. Create a General story: the setting page is empty apart from the shared defaults, and Save setting refuses until the genre and style and the world are filled. The main character form starts empty and needs only a name.
2. On the Novel page, Write is off with an empty direction. Type one and write blocks: none shows suggested actions. End the chapter: the Start chapter screen has no openings, and the first block of chapter 2 needs a direction too.
3. With a real provider, write a chapter of an unusual genre (for example a 1920s cozy mystery with "no magic" as a rule): the AI keeps to both. Check the AI call log: no suggestions are asked for.
4. Open the bookshelf and a General story in light and dark: the quill spine and the abstract background match the other types, and a long chapter reads easily.
5. Write a block in a cultivation, romance and fantasy story: suggestions and openings are still there.
