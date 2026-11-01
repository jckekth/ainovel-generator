# AI Novel Generator: Spec

Last updated: 2026-11-01

This file is the source of truth for what the app does. Reasons for the choices are in [decisions.md](decisions.md).

## 1. Overview

The app is a standalone desktop program for Windows and Linux (decision 92) that writes an interactive novel with an AI API. The user sets up a world and characters, the AI writes the story in short blocks, and the user steers after each block.

Goals for v0.1, the base version (decision 63):

- Multiple saved stories, each with a Novel page, a Character page and a Setting page.
- Two story types: cultivation and romance.
- Token cost per request stays flat no matter how long the story gets.
- All story data is stored as readable markdown files on the user's device.
- Each user supplies their own API key.

v0.2 (phase 6) adds a UI in English, 简体中文 and 繁體中文, curated example sets with Randomize, previous / next chapter links, token use per block and chapter, notes on suggested actions, and visible progress for long steps (spec 5, 6.6, 8, 11).

v0.3 (phase 7) adds a new look: a top navigation bar with an About page, a chapter side list, a black, white and gray style with the story list as a bookshelf, background art for each story type and shared character figures, a third story type (fantasy) and simple animation (spec 7.6, 8.5, 10, 12).

Out of scope for v0.1: Android build and phone layout, Steam integration, more story types, sharing or exporting stories. What comes after v0.1, up to v1 (the first production release), is the roadmap in [progress.md](progress.md#roadmap).

## 2. Tech stack

| Layer | Choice |
| --- | --- |
| App shell | Tauri 2 |
| UI | React + TypeScript, built with Vite |
| File storage | Tauri file-system plugin, called from the React side |
| API key storage | OS credential store (Windows Credential Manager; on Linux the Secret Service, such as GNOME Keyring or KWallet), through small Rust commands |
| AI API | OpenAI-compatible chat completions, streaming |
| Data format | Markdown with a YAML header; JSON for app state |

- The AI layer sits behind one small interface (send messages, receive a stream), so another provider format can be added without touching the pages.
- The API base URL is a setting, not a constant.

## 3. Data storage

Each story is one folder of plain files in the app's data folder: `%APPDATA%\ainovelgenerator` on Windows and `~/.local/share/ainovelgenerator` on Linux (decision 154).

```
app-data/
  app-settings.json            global settings, the UI language included (no API key)
  stories/
    <story-id>/
      story.json               title, type, language, status, chapter count, curated set
      setting.md               the one world setting for this story
      summary.md               rolling "story so far" summary
      scenes.md                used scenes list (spec 6.4)
      notes.md                 pinned story notes written by the user
      characters/
        <character-id>.md      one file per character
      chapters/
        001/
          chapter.md           final chapter text, read-only
          summary.md           summary of this chapter, with the next chapter's openings
          review.json          proposed character changes and the user's answers
          snapshot/            copy of setting.md and characters at chapter end
          picture.webp         Lite picture; or pictures/ with pictures.json in Rich (spec 14.3)
        002/ ...
      draft/
        draft.json             the chapter in progress
        pictures/             Rich pictures of the chapter in progress (spec 14.3)
      ai-log/                  development builds only: one file per AI call
```

| File | Format | Changed by |
| --- | --- | --- |
| `setting.md`, character files | YAML header for form fields, markdown body for free text | User; the AI only through approved proposals |
| `chapter.md` | Markdown | Written once at End Chapter, then never changed |
| Chapter `summary.md` | YAML header with the chapter title, the next chapter's openings and the tokens the chapter used (spec 6.6); markdown body of about 150 words | Written once by the AI at End Chapter; the user can edit the title |
| Chapter `review.json` | JSON: the AI's proposed character changes and the user's answer to each | End Chapter review |
| Story `summary.md` | Markdown, capped length | Rewritten by the AI at End Chapter |
| `notes.md` | Markdown list | User only |
| `draft.json` | JSON: blocks, user directions, regenerate variants, tokens used so far (spec 6.6) | Autosaved after every block |
| `story.json` | JSON: title, type, novel language, status, chapter count, ending, the curated set the setting came from (`setId`, spec 8), and when it was last opened (`openedAt`, for the bookshelf order, decisions 109, 115) | The app |

Choice values (a tone, a gender, a trope) are always saved in English, whatever the UI or novel language, so switching either language never breaks a saved file (spec 11).

Settings has an "Open data folder" button.

**Moving from the old folder (decision 154).** Builds before 2026-11-01 named the data folder after the bundle identifier (`com.jckek.ainovelgenerator`). On start, if the new folder has no `app-settings.json` and no `stories/`, the app moves both from the old folder into the new one, and removes the old folder if it is then empty. If the move fails, the app starts with an empty folder and the old files stay where they were, to be moved by hand.

The Windows installer is one setup file that installs for the current user, without administrator rights. Uninstalling leaves the data folder in place.

On Linux the app comes as a `.deb` package and an AppImage (decision 92). Removing the package or deleting the AppImage leaves the data folder in place.

**AI call log (development builds only).** In `npm run tauri dev` and `npm run dev`, every block request is saved as a readable markdown file in the story's `ai-log/` folder: the time, outcome, model, budget, prompt layers and characters in the scene, every message exactly as sent, and the raw answer (or the part that arrived before an error or Stop). The API key is never written. The newest 100 files per story are kept. Installed builds write no log.

## 4. Story types

A story type is a config file, not code. It defines:

- **Character fields:** the extra fields this genre adds to the common ones, with their input type (text, number, choice, list, scale).
- **Setting fields:** the same, for the Setting page.
- **Setting defaults:** a default for every setting field. The type can override the default of a field shared by all types (for example the tone).
- **Curated sets** (decision 72): several ready-made worlds of the type, each in English, 简体中文 and 繁體中文, in `src/storyTypes/sets/<type>.json`. A set fills every setting field that differs by genre (the tone and the world background for all; the rank ladder, cruelty, mortality, sects, difficulties and power growth for cultivation; era and place, supportiveness, trope, pace, rivals and ending for romance; races, adventurer ranks, magic system, how common magic is, factions, danger, mortality, difficulties and power growth for fantasy), and has a main character and a name pool that fit its era and place.
- **Art** (spec 12.3): a background image, named after the type. The character figures are shared by all types.
- **Prompt fragments:** the genre's writing instructions.
- **Main character rule:** what the main character must have.
- **Suggestions** (decision 125): whether the AI offers suggested actions under each block and openings for the next chapter. On for every type but General.

**The General type (通用, phase 7b, decisions 125–128).** For stories in any genre the other types do not cover (sci-fi, mystery, horror, slice of life and more). It has the fewest fields and relies on what the user writes: the world is a few text boxes (spec 8.6), characters have the common fields plus one notes box (spec 7.7), and the AI offers no suggestions, so every block starts from the user's own direction (spec 5.1). It has no curated sets, no Randomize, no name pool and no example main character: its setting and main character start empty, apart from the shared defaults (narration detail, point of view, lengths, rating, main character death), and its required boxes must be filled before the story can start.

Rules:

- The Character and Setting pages build their forms from the story type file.
- The story type is chosen when a story is created and cannot be changed afterwards.
- Creating a story follows a fixed order: choose type and language, fill in the setting, create the main character. The Novel page stays locked until all three are done.
- Labels, hints, placeholders, options and section names in a story type file are written in English; their Chinese versions are in the translation files (spec 11). A config test checks that each one has both.

## 5. Novel page

A chapter is written as several short blocks, and the user gives a direction after each one.

```
Give a direction -> AI writes a block -> user chooses:
    regenerate latest block  -> back to "AI writes a block"
    continue the chapter     -> back to "Give a direction"
    End Chapter (or hard limit)
        -> chapter saved, now read-only
        -> AI writes summaries and proposals
        -> user reviews character changes
        -> next chapter
```

### 5.1 Writing a chapter

1. The page opens on the chapter in progress, or on a "Start chapter N" screen if there is none.
2. The user gives a direction. For the first block of any chapter this is optional (decision 65), except in a story type without suggestions (General), where every block needs one and the Write button stays off until the box has text (decision 126). From chapter 2 on, the Start chapter screen also offers two or three chapter openings from the previous chapter's End Chapter call (spec 5.4); picking one writes the first block at once.
3. The AI writes one block of about 300–500 words, streamed onto the page. A Stop button cancels it; the unfinished block is discarded and the draft is unchanged.
4. Under the block (in a type with suggestions, spec 4), the AI offers two or three suggested next actions, each with a short note on what it might do to the story (spec 6.3), such as "raises the stakes with a rival". The user picks one (which writes the next block at once, with the action alone as the direction) or types their own. Blocks written before notes existed show their actions without notes.
5. Steps 3 and 4 repeat until the user clicks End Chapter or the chapter reaches its hard limit.

The draft is autosaved after every block, and only when a block has arrived in full. A block the provider cut off is an error, not a short block: a stream that closes before it says it is finished, or an answer stopped at the provider's output limit (decision 74).

**Action bar (decision 64).** A bar fixed to the bottom of the Novel page stays on screen while the user scrolls. It holds the chapter progress bar (spec 5.3), the tokens the chapter has used so far (spec 6.6) and the End Chapter button. While a block (or the epilogue) is being written, the bar shows "Writing…" (or "Rewriting…") with a spinner and the Stop button, so it is visible from anywhere on the page; the block streams into view above it (decision 88). End Chapter and End story never look like the other buttons:

- **End Chapter:** its own colour and a chapter-end icon, set apart from the block buttons (regenerate, suggested actions, direction).
- **End story:** a warning colour and its own icon. It stays outlined until the planned chapters are written (spec 5.7), then turns solid.
- Both still ask for confirmation first.

`draft.json` holds the chapter number and a list of blocks. Each block has the user's direction and its versions; each version has the story text, the suggested actions and their notes, the died flag, the regenerate hint (if any), the tokens it used and when it was written. The block also records which version is chosen. The draft also keeps the tokens of every block call of the chapter, dropped versions included (spec 6.6). Once a chapter ends with a story ending (spec 5.5), the draft also holds that ending until the chapter is finished (decision 75).

### 5.2 Regenerate

- Only the latest block can be regenerated, and only before End Chapter.
- The user can add a hint, such as "make the fight shorter".
- Earlier versions of that block are kept in the draft so the user can switch back.
- Once the user gives the next direction, the chosen version is fixed and the other versions are dropped.
- Block text cannot be edited by hand.

### 5.3 Chapter length

| Chapter length | Target (soft limit) | Hard limit (150%) | Typical blocks |
| --- | --- | --- | --- |
| Short | 1,500 words | 2,250 words | 4–5 |
| Medium | 2,500 words | 3,750 words | 6–8 |
| Long | 4,000 words | 6,000 words | 10–12 |

- A progress bar shows the chapter's word count against its target.
- At the soft limit, the AI is told to steer toward a natural chapter ending, and the End Chapter button is highlighted.
- At the hard limit, the next block is written as the chapter's conclusion and the chapter then ends: no more blocks can be written, and End Chapter is the only step left. The concluding block can still be regenerated.
- For Chinese, Japanese and other languages without spaces, the count is in characters: Short 2,500, Medium 4,000, Long 6,500. Korean is counted in words.

All numbers are starting values to tune after reading real output.

### 5.4 End Chapter

1. The blocks are joined and saved as `chapter.md`. From here the chapter is read-only.
2. One AI call returns: a chapter title, the chapter summary, the updated "story so far" summary, the updated used scenes list (spec 6.4), two or three openings for the next chapter (spec 5.1; left out for a type without suggestions), and proposed character changes.
3. The user can edit the title, then reviews the proposed character changes and approves or rejects each one.
4. The setting and character files are copied into the chapter's snapshot folder, and the draft is cleared.

If the AI call in step 2 fails, the chapter text is already saved. The app shows a retry button, and a new chapter cannot start until the summary exists.

**Progress (decision 88).** Steps 1 and 2 run behind a dialog with a spinner and the current step: "Saving the chapter…", "Writing the summary and character changes…", "Saving the summary…". The dialog has a Stop button while the AI call runs; stopping leaves the chapter saved and "summary pending", as leaving the story does (spec 9). Accepting the epilogue shows the same dialog ("Saving the epilogue…"), without Stop.

- The draft stays until step 4, so the setting stays locked during the review. A chapter is "ended" once its `chapter.md` exists.
- The AI's answer is saved as soon as it arrives: the title and chapter summary in the chapter's `summary.md`, the new "story so far" in the story's `summary.md`, and the proposals in the chapter's `review.json`. An edited title is saved as it is typed. Closing the app during the review loses nothing.
- The chapter count and an accepted ending in `story.json` are repaired from the chapter files if saving them fails: when the story is opened again, and before the draft is cleared in step 4 (decision 75).
- Approving a proposal writes it to the character file at once; the old value shown is read from the file, not from the AI. A proposal that already has an answer cannot be applied again, and a new character whose name now exists is refused. A proposal for an unknown character or field, or with a value the field does not allow, is dropped.
- A proposed new character can be accepted as it is (if it passes the character form's checks), edited first, or rejected.
- The review is finished when every proposal has an answer.

### 5.5 Ending a story

A story ends with an epilogue chapter, either because the main character died or because the user chose to end it.

**Main character death.** The story's "Main character death" setting controls it:

- **Never:** the AI is told the main character always survives, even if a direction asks otherwise.
- **Only when I direct it** (default): the main character dies only if the user's direction says so.
- **The AI may decide:** the AI can kill the main character when the story and the world's cruelty call for it.

Every block comes back with a flag saying whether the main character died in it. When the flag is set, the app pauses and the user chooses:

1. **Regenerate the block.** The death is undone like any other regenerated block.
2. **Accept the death.** The current chapter ends through the normal End Chapter steps, then the epilogue is written.

**Ending by choice.** An "End story" button, available between chapters, leads to the same epilogue step without a death.

While the died flag is set on the latest block, no next block can be written; the page offers only the two choices above.

Under **Never**, the user cannot accept a death the AI wrote anyway: the page says the setting is Never and offers only Regenerate.

**The epilogue.** One final chapter written in a single pass, at the Short chapter length. The user can give one optional direction first. It can be regenerated until the user accepts it.

- The epilogue is kept in the draft as one block with versions, like a regenerated block. Accepting it saves it as the last chapter folder with the title "Epilogue" and a snapshot; it has no AI summary call.

**After the epilogue.** The story is marked Completed. Every chapter stays readable, and no new chapter can be started.

### 5.6 Reading earlier chapters

A chapter list opens any earlier chapter in a read-only view, loaded from its `chapter.md`.

- At the top and the bottom of the reader, links go to the previous and the next chapter, each with its title. The first chapter has no previous link; from the last finished chapter, "next" goes back to the current chapter.
- Reading an earlier chapter never loses the chapter in progress: its blocks, and a block still being written, are there when the reader goes back (decision 91). A page that somehow still shows an older version of the chapter cannot write over the blocks saved since: the next block is refused with a message to open the story again.
- The reader shows the tokens the chapter used, when they were recorded (spec 6.6). Chapters ended before phase 6 show none.

### 5.7 Story length

The Setting page's "Story length" tells the AI how the whole story is paced. It never ends a story by itself.

| Story length | Planned chapters | Pacing told to the AI |
| --- | --- | --- |
| Short story | About 8 | One arc: set-up, rising conflict, climax and resolution across the planned chapters |
| Long story | About 60, as 3 volumes of about 20 | Each volume has its own arc and climax; the whole story builds to a final climax |
| Continuous (default) | No planned end | One arc after another; the main conflict is never resolved for good |

- Every block's instructions say where the story is: the chapter number, its volume for a Long story, and the stage of the arc.
- In the last two planned chapters of a Short or Long story, the AI is told to steer toward the finale. Once the planned chapters are written, the "End story" button is highlighted; the user can still go on.
- Like the rest of the setting, it can be changed between chapters.

## 6. Context and token budget

Every request sends a fixed set of capped parts, never the full history.

### 6.1 Prompt order

Parts that rarely change come first, so providers with prompt caching can discount them.

1. Writing instructions and the story type's prompt fragments, including the output language and content rating.
2. `setting.md`.
3. Pinned story notes.
4. Character files for the characters in the scene.
5. The "story so far" summary.
6. The used scenes list (spec 6.4).
7. Summaries of the most recent chapters.
8. The last paragraphs of the previous chapter.
9. The current chapter's blocks so far, in full.
10. The user's direction for the next block.

- **Characters in the scene:** the main character, plus any character whose name appears in the current chapter, the user's direction, or the previous chapter's summary. A plain name match, with no extra AI call.
- **Rich budget:** also adds every character whose name appears in the last 3 finished chapters.
- **Previous chapter tail** in a language without spaces is counted in characters: 300 words become 500 characters, 600 words 1,000 (the same ratio as spec 5.3).
- **Name matching:** names in Latin script match as whole words; Chinese, Japanese and Korean names match anywhere. Inactive characters other than the main character are left out.
- **Keeping the summary capped:** when the "story so far" summary passes its cap, the End Chapter call is told to compress the oldest events into shorter arc-level lines. Tokens are estimated as words × 4/3, or one per character in languages without spaces.

### 6.2 Budget levels

| Part | Lean | Balanced (default) | Rich |
| --- | --- | --- | --- |
| "Story so far" cap | 600 tokens | 1,000 tokens | 1,500 tokens |
| Used scenes list cap | 200 tokens | 300 tokens | 450 tokens |
| Recent chapter summaries | Last 1 | Last 3 | Last 5 |
| Previous chapter tail | None | 300 words | 600 words |
| Character detail | Header fields only | Full file | Full file, plus characters from the last 3 chapters |
| Current chapter | Full | Full | Full |
| Estimated input per block | 3,000–6,000 tokens | 4,000–8,000 tokens | 6,000–11,000 tokens |

Token figures are estimates for English with Medium chapters. Each block's output is about 400–700 tokens. The End Chapter call adds one request per chapter.

### 6.3 Block response format

The AI is asked to answer every block in this shape:

```
<the story text>

=== NEXT ===
<suggested action> | <what it might do to the story>
<suggested action> | <what it might do to the story>
<suggested action, optional> | <what it might do to the story>
MAIN CHARACTER DIED: no
MOOD: none
PICTURE: <the scene, in English; Rich only, spec 14.2>
```

- The marker, the flag line and the mood line are always in English; the story text, the actions and their notes are in the novel's language.
- Each action line is the action, a `|` (or the full-width `｜`), then a note of a few words on what it might lead to (decision 86). The note is shown under the action and is never sent back as the direction. A line without the bar is an action with no note.
- The marker is found even when it ends a story line with no line break before it, as some providers write it (decision 90). Blocks and chapters saved before this rule are split when they are read; the files are not rewritten.
- While streaming, only the text before the marker is shown, and the end of a line that may still become the marker is held back.
- Without the marker, the whole answer is the story text, with no suggested actions. A line that is only the flag (`MAIN CHARACTER DIED: …`) is still read and never shown, also in blocks and chapters saved before this rule. An empty answer is an error.
- The mood line (`MOOD: <mood>`) picks the background music for the block (spec 13). It is read like the flag line, wherever it is found after the marker, and never shown. It is saved with the block. A missing line, an unknown mood, or a block saved before this rule counts as `none`.

### 6.4 Avoiding repeated scenes

Across chapters, the AI tends to reuse the same kinds of scenes (decision 66). To stop this:

- The story keeps a **used scenes list** in `scenes.md`: one short line per scene type or turning point the story has already used, such as "rival humiliates the main character in public" or "rescue during a storm". The End Chapter call returns the whole updated list.
- The list is sent with every block, under the instruction: these scenes have already happened; do not stage them again in a new form, and move the story to situations it has not had yet.
- The writing instructions also say that every block must bring something new: a place, fact, choice or consequence.
- When the list passes its cap (spec 6.2), the End Chapter call is told to merge similar lines into broader ones, as the summary is compressed. If it is still over the cap, a block request sends only the newest lines that fit, so the request size stays flat.
- An End Chapter answer without the list keeps the old one.
- A story without `scenes.md` (begun before this rule) starts with an empty list.

### 6.5 Writing in the novel's language

The instructions are in English, whatever the novel's language. So that the prose reads as if it were written in that language and not translated (decision 70):

- For any language other than English, the instructions add a "Writing in <language>" section after "How to write": write as a native novelist of that language, with its own word order, rhythm, idioms and dialogue, and humour and images that work in it.
- Simplified and Traditional Chinese get their own notes, written in that script: avoid 翻譯腔 (piled-up 的, the 被 passive, 當……的時候, every sentence starting with 他 or 她), natural spoken dialogue, Chinese humour and images, “” for dialogue in Simplified and 「」 in Traditional.
- Suggested actions and the next chapter's openings say what the main character does next, starting with their name or the action, never as a request ("Have …", 請…, 讓…). The epilogue, which has no suggested actions, leaves that note out.
- Other languages can get their own notes in `src/lib/languageStyle.ts`.
- **Choice values in the novel's language (decision 84).** The setting file and character files sent with a block, and the tone and narration detail in the instructions, carry every choice value in the novel's language (`Happy` becomes 歡樂 in a Traditional Chinese story), taken from the same translation files as the UI (spec 11). Field keys stay in English. The End Chapter call lists the allowed values in the novel's language too, and a proposed value is read back to the English one before it is checked; an English value is still accepted.
- A story in a language outside the three (Japanese, Korean or Malay, from before phase 6) gets the general native-prose rule, English examples and English choice values.

### 6.6 Token use

The tokens each AI call used are shown, so the user can see what the story costs (decision 87).

- Block requests ask for the provider's usage report (`stream_options: {"include_usage": true}`); the input and output tokens come from the report's `prompt_tokens` and `completion_tokens`. A provider that refuses `stream_options` with a 400 or 422 naming it is asked again once without it.
- When no report comes, the tokens are estimated (spec 6.1: words × 4/3, one per Chinese, Japanese or Korean character) from the messages sent and the answer, and shown with "≈" and the word "estimated".
- Each block version keeps its own tokens; the writing page shows them under each block. The draft adds up every successful block call of the chapter, regenerated versions included, and the action bar shows that total. A call that failed or was stopped is not counted, since the provider's report never arrived.
- At End Chapter, the chapter's total (its blocks plus the End Chapter call) is saved in the chapter's `summary.md` and shown in the review and the chapter reader. The epilogue saves its own blocks' total when it is accepted.

## 7. Character page

Every character is one markdown file: common fields, the story type's extra fields, and a free-text background.

### 7.1 Rules

- A story has exactly one main character, created before the first chapter. It cannot be deleted.
- The main character form starts filled in with the main character of the story's curated set (spec 8), in the novel's language, so it can be saved without typing. Other new characters start empty.
- **Randomize (decision 85).** On every character form, a "Random name" button next to the name fills in a name from the set's name pool: one that fits the chosen gender (any, when none is chosen), that no character of the story has, and that differs from the name in the field. The main character form also has "Use the setting's main character", which fills the whole form with the set's main character.
- The user can edit any character at any time. Edits apply from the next block.
- The AI never edits a character file directly. It proposes changes at End Chapter and the user approves each one.
- Characters that have appeared in a chapter are not deleted. They are marked dead or inactive instead.

### 7.2 Fields for all story types

| Field | Input |
| --- | --- |
| Name | Text |
| Gender | Choice |
| Age | Number (18 or higher in romance stories) |
| Is main character | Yes / no, set once |
| Relationship with main character | Text (not shown for the main character) |
| Sexual orientation | Choice |
| Moral alignment | Scale from good to bad |
| Charisma | Scale 1–10 |
| Personality traits | Short list |
| Goals and fears | Text |
| Speech style | Text |
| Appearance | Text, optional: how the character looks, sent with pictures that name them (spec 14.2) |
| Current status | Alive / dead / inactive, plus location and condition |
| Background summary | Free text (the file's body) |

### 7.3 Extra fields: cultivation

| Field | Input |
| --- | --- |
| Cultivation rank | Choice from the rank ladder on the Setting page |
| Sect or affiliation | Text |
| Spiritual root or element | Choice |
| Special ability | Text; required for the main character |
| Sacred items | List |
| Techniques | List |
| Inventory | List |

### 7.4 Extra fields: romance

| Field | Input |
| --- | --- |
| Occupation | Text |
| Body build and height | Choice + text |
| Hair | Length and colour |
| Other appearance notes | Text |
| Love language | Choice of the five love languages |
| Attachment style | Choice: secure, anxious, avoidant, mixed |
| Flaws | Short list |
| Affection toward main character | Scale 0–100 (not shown for the main character) |
| Relationship stage with main character | Choice: stranger, acquaintance, friend, crush, dating, partner, ex |

### 7.5 AI-proposed changes

- At End Chapter the AI returns a list of proposals, each shown as field, old value, new value and a one-line reason.
- A proposed value replaces the whole field, so the call tells the AI to keep everything in the old value that is still true and drop only what the chapter shows has ended (decision 138). A lasting mark, scar, illness or curse stays in the condition when a new wound is added.
- If the chapter introduced a new named character, the AI proposes a pre-filled character file. The user can accept it, edit it first, or reject it.
- A proposed new character always comes with an age (decision 67). The End Chapter call must give one, a best guess from the chapter, at or above the story type's minimum (18 in romance). If the age is missing or below the minimum, the app fills in the story type's default age and the review card says so. The user never has to type an age just to accept a proposal.

### 7.6 Extra fields: fantasy

Phase 7 (decisions 101, 104, 105, 113, 114). The main character must have a class. A new character the AI proposes without an age gets the default age of 20 (spec 7.5, decision 67); Add character starts with the age empty. There is no minimum beyond the common age field.

| Field | Input |
| --- | --- |
| Race | Choice from the races on the Setting page (spec 8.5): each line gives one option, the name before its colon. A race no longer in that list is shown as saved (decision 113) |
| Class | Choice: warrior, knight, mage, healer, rogue, ranger, bard, other; required for the main character. Other opens a text box that must be filled (for example "necromancer"); the typed class is what is saved and sent to the AI (decisions 105, 114) |
| Adventurer rank | Choice from the adventurer ranks on the Setting page (spec 8.5), or none; optional for every character, the main character included. Not shown when the setting has no ranks. A rank no longer in that list is shown as saved (decision 104) |
| Faction or kingdom | Text |
| Magic affinity | Choice: none, fire, water, earth, air, light, shadow, arcane |
| Abilities and spells | List |
| Equipment | List |
| Inventory | List |

### 7.7 Extra fields: general

Phase 7b (decision 128). The main character needs only the common required fields (the name).

| Field | Input |
| --- | --- |
| Abilities and notes | Text: skills, powers, gear or anything else the AI should know about the character |

## 8. Setting page

Each story has exactly one setting file. A new story's Setting page starts with a default in every field, including an example world background, so it can be saved without typing anything; the language comes from the story. The pinned story notes (spec 3, `notes.md`) are edited on this page too, one note per line; they are not locked.

**Curated sets (decisions 72, 85).**

- Creating a story picks one of its type's curated sets at random and saves its id in `story.json` (`setId`). Until the setting is first saved, the Setting page shows that set, so reopening the story shows the same world. Two new stories of the same type can start with different sets.
- A set's text (world background, names, sects, rank ladder, the main character) comes in the novel's language: English, 简体中文 or 繁體中文; any other language gets the English text. Changing the novel's language on the Setting page swaps in the set's text in the new language for every field still holding the set's text; fields the user changed stay as they are.
- A **Randomize** button on the Setting page fills the form with another set of the same type, never the one shown: every field the set covers and the world background. Fields a set does not cover (narration detail, point of view, chapter length, story length, content rating, main character death, the language) keep their values. Like any edit, it is saved only with Save setting, which also saves the new `setId`. It is a setup tool: once the story has started (below), it is not offered (decision 89).
- The name pool and the main character on the character forms come from the story's `setId`. A story from before phase 6, which has none, uses the type's first set.

**Novel languages (decision 71).** The language of the novel is one of English, 简体中文 (Simplified Chinese) and 繁體中文 (Traditional Chinese). A new story's language starts as the UI language (spec 11); the user can pick another. A story created earlier in another language (Japanese, Korean, Malay or a typed one) keeps it: the Setting page shows it, and the story still opens and writes blocks.

**The language is fixed once the story has started (decision 89).** A story has started from the moment the first block of chapter 1 is being written (the same moment the setting first locks, spec 8.1); a story with an ended chapter has started too. From then on the language field on the Setting page is disabled, with the note "The novel's language is fixed once the story has started. To write in another language, start a new story.", and saving the setting refuses a different language. Until then the user can change it freely, and the set's text follows (above). Every other setting field can still be edited between chapters.

### 8.1 Locking rule

- The setting is locked from the first block of a chapter until End Chapter. The lock starts as soon as that block is being written, before it has arrived.
- Between chapters the user can edit it. The change applies to chapters written afterwards.
- Earlier chapters keep the setting they were written with, in their snapshot.

### 8.2 Settings for all story types

| Field | Input |
| --- | --- |
| Language of the novel | Choice |
| Background summary of the world | Free text (the file's body) |
| Tone | Up to two of: sad, happy, hot-blooded, dark, humorous |
| Narration detail | Detailed / moderate / brief |
| Point of view | Main character first person / main character third person / god view |
| Chapter length | Short / medium / long |
| Story length | Short story / long story / continuous (spec 5.7) |
| Content rating | General / Mature (intimate scenes fade to black) |
| Main character death | Never / only when I direct it (default) / the AI may decide |

### 8.3 Extra settings: cultivation

| Field | Input |
| --- | --- |
| Rank ladder | Ordered list of ranks, each with sub-stages; a default ladder is pre-filled |
| World cruelty | Scale 1–5 |
| Character mortality | How easily named characters die: rarely / sometimes / often |
| Major sects and factions | List with one line each |
| Difficulties faced by the main character | Text |
| Speed of power growth | Slow / steady / fast |

### 8.4 Extra settings: romance

| Field | Input |
| --- | --- |
| Era and place | Choice: modern city, campus, office, historical, fantasy, other |
| World supportiveness toward the main character | Scale 1–5 |
| Trope | Choice: slow burn, enemies to lovers, childhood friends, fake relationship, second chance, other |
| Relationship pace | Slow / medium / fast |
| Rivals | None / one / several |
| Ending tendency | Happy / bittersweet / open |

### 8.5 Extra settings: fantasy

Phase 7 (decisions 101, 104).

| Field | Input |
| --- | --- |
| Races of the world | List with one line each; the set's races are pre-filled |
| Adventurer ranks | Optional ordered list, lowest first, one rank per line (for example Copper, Iron, Silver, Gold, Mithril). Each curated set pre-fills a ladder that fits its world; clearing the list turns ranks off for the story (decision 104) |
| Magic system | Text: how magic works and what it costs |
| How common magic is | Rare / uncommon / common |
| Major factions and kingdoms | List with one line each |
| World danger | Scale 1–5 |
| Character mortality | How easily named characters die: rarely / sometimes / often |
| Difficulties faced by the main character | Text |
| Speed of power growth | Slow / steady / fast |

**Curated sets (decision 106).** Four worlds, each with a main character of a different class:

| Set | World | Main character |
| --- | --- | --- |
| The Fading Crown | Classic high fantasy: a dying king, elves and dwarves, an old evil returning | A young knight |
| Ash and Iron | Grim, low magic: magic is rare and costs life or memories; mercenary companies and plague | A rogue sellsword |
| The Spire Academy | Magic is common: a city of mages, academy politics, a forbidden library | A mage student |
| The Wildmarch | Frontier: unmapped lands, beast-folk, ancient ruins | A ranger |

In the Chinese sets, names are transliterated (艾莉娅, 凯尔) and races use the usual words (精灵, 矮人, 兽人).

**Prompt fragments.** Magic follows the setting's magic system and always has its cost; each race has its own culture; spells and items keep the limits once established; power grows at the setting's pace; if the story has adventurer ranks, characters rise one rank at a time and only by deeds, never skipping ranks or inventing ones outside the list. The fantasy is Western in flavour: no cultivation words (qi, meridians, sects, dao), also when the novel is in Chinese.

### 8.6 Extra settings: general

Phase 7b (decisions 128, 129). The boxes sit under the heading "About your world", right after the world background and before the shared Story fields (language, tone, lengths and so on), since they are what the user must write first. Every field starts empty; the two required ones must be filled before the setting can be saved. Each has a hint and a placeholder example so the empty page says what to write.

| Field | Input |
| --- | --- |
| Genre and style | Text, required: for example "cozy mystery in 1920s London, light and witty" |
| World and background | The world background summary shared by all types (spec 8.2), required here, with no example text |
| Important places | Text |
| Groups and factions | Text |
| Rules of this world | Text: magic, technology, laws, anything the AI must never break |

The tone (spec 8.2) is optional here and starts empty; the genre and style says the rest.

## 9. Global settings

| Group | Setting | Notes |
| --- | --- | --- |
| AI | API key | Stored in the OS credential store; shown masked |
| AI | Base URL | Defaults to OpenAI's |
| AI | Model | Text field; testing the connection lists the available models |
| AI | Test connection | One small request; reports success or the error in plain words |
| AI | Context budget | Lean / Balanced / Rich |
| Appearance | Language | The UI language: English, 简体中文 or 繁體中文 (spec 11) |
| Appearance | Font size | Applies to the reading view |
| Appearance | Theme | Light / dark |
| Appearance | Background art | On (default) / off: the story type's background and character figures (spec 12.3). Saved as `backgroundArt` in `app-settings.json` |
| Sound | Music | On (default) / off: background music at the story's emotional peaks (spec 13). Turning it off stops any music at once. Saved as `music` in `app-settings.json` |
| Sound | Volume | 0–100%, default 50%. Saved as `musicVolume` in `app-settings.json` |
| Images | Level | None (default) / Lite / Rich, with the cost shown first (spec 14.1). Saved as `images` in `app-settings.json` |
| Images | Image provider | Base URL, key (OS credential store), model, Quality (Low / Medium), a "Same as the text AI" switch and Test connection (spec 14.1) |
| App | Open data folder | Opens the data folder in the file explorer |

- On first launch the app opens this page with a short guide to getting an API key.
- Opening this page shows a setup guide in a dialog: pick a provider, create a key on its site, paste it, set the base URL, test the connection, pick a model. Each listed provider (OpenAI, DeepSeek, OpenRouter) has a link to its key page and a button that fills in its base URL. The guide opens by itself only on first launch (no key and no stories); after that a "Setup guide" button in the AI group opens it at any time.
- API errors are shown in plain words with the next step: wrong key, no credit, rate limit, no connection, wrong model name. No credit (a 402, or a 429 whose code says the quota is used up) says to add credit with the provider; any other 429 says to wait a minute and try again. When the provider sends its own error message, it is shown after ours. A failed block never loses the draft.
- If the system's password store cannot be reached (on Linux, no keyring such as GNOME Keyring or KWallet is installed or unlocked), saving the key says so in plain words and what to install or unlock. The app still opens, and stories can be read and set up; only writing needs the key (decision 93).
- Leaving a story with unsaved Setting edits asks first whether to discard them.
- Leaving a story while a block is being written asks first; leaving stops and discards the block, and the chapter stays as it was. The End Chapter call runs behind its progress dialog (spec 5.4), whose Stop does what leaving does: the call stops, the chapter stays saved, and its summary can be tried again. If the story is left another way while the call runs, the app asks first in the same way. Only one End Chapter call per story runs at a time. A direction or regenerate hint that was typed but not sent is kept when the user leaves the story and comes back, until the app closes.

## 10. About page

Planned for phase 7 (decisions 79, 80 and 94). The app is free; this page says who made it and where to find it. The app's itch.io page is its home: downloads, updates, bug reports and the optional donation all live there.

- **About** sits in the top navigation bar after Stories and Settings, and is reachable from every page, including before an API key is set.
- **Credits:** app name, version (read from the build, not typed; it moves here from the navigation), "Made by" with the author's name, and a short line thanking the open-source projects it is built on (Tauri, React) and the art and music sources added in phases 7 and 8, each with its licence. For phase 7 these are Tauri (MIT or Apache-2.0), React (MIT), the Literata font (SIL Open Font License), the Phosphor icons (MIT) and the background and character art, made by the author with ChatGPT, all rights reserved (decision 97).
- **Contact:** the author's email address as plain text with a Copy button next to it; clicking Copy puts the address on the clipboard and the button shows "Copied" for a moment. Nothing opens a mail app, and nothing is sent from inside the app (decision 107). A web link added later opens in the default browser.
- **Home page:** a button that opens the app's itch.io page in the default browser, with one plain line under it: news, updates and bug reports are there, and the app is free. The app itself does not ask for donations; supporting the author is offered on the itch.io page (itch.io's own "support the developer" option). No payment is taken inside the app, and nothing in the app is locked behind a donation.
- The author's name, contact links and the itch.io address are fixed in one config file in the code (`src/about.config.ts`), not settings the user can edit. The page text is translated like the rest of the UI; names and links are not.
- **Values (decision 107).** Made by: **JC Do Things**. Contact: **jc.do.things@gmail.com** (with a Copy button). The itch.io page does not exist yet, so its address stays a placeholder.
- **Placeholders (decision 94).** Until the author gives the real values, the config holds placeholders (now only the `example.itch.io` address), and the page is built and tested with them. The installer build (`npm run tauri build`) stops with a plain message naming each placeholder still left, so no release ships one; development builds and tests run with them.
- No reminders or pop-ups ask for donations.
- A build for another store (Steam, in Later) may need the home page link changed or hidden to meet that store's rules; the config file has one switch per link for this. That is decided when that store's packaging is planned.

## 11. UI languages

The UI comes in English, 简体中文 and 繁體中文 (decisions 68, 83). The UI language and the novel's language are separate choices (decision 71).

- **Every text the user reads is translated:** labels, buttons, hints, placeholders, notices, dialogs, and the error messages from the app's own code (file errors, AI errors, form checks). Story type labels, options and section names too (spec 4). What is not translated: the story's own content (titles, setting, characters, chapters), the provider's own words in an error message, and the development AI call log.
- **Translation files:** `src/i18n/en.ts`, `zh-Hans.ts` and `zh-Hant.ts`. English is the source; the type check fails if a Chinese file misses a UI key. Story type texts are keyed by field key (`field.<key>.label`, `option.<key>.<English value>`), in the same files.
- **Choosing it:** Settings → Appearance → Language, with each language named in its own script. It applies at once, on every page, without losing unsaved edits, and is saved in `app-settings.json` as `uiLanguage` (`en`, `zh-Hans` or `zh-Hant`). Until a language is chosen (on a new install, and for a settings file from before phase 6), it follows the system's language: Chinese for Taiwan, Hong Kong and Macau, or written in the Traditional script, is 繁體中文; other Chinese is 简体中文; anything else is English.
- **Choice values:** a choice is saved in English (spec 3) and shown in the UI language. The AI gets it in the novel's language (spec 6.5). A value with no translation is shown as saved.
- Switching the UI language never changes a story's language, its files or its prompt.

## 12. Look and feel

Phase 7 (decisions 95–123). The app should look like a place to read and write stories, not a form. Everything here works at the smallest window size (900 × 600), in the light and dark theme, and in all three UI languages.

### 12.1 Layout and navigation

- **Top navigation bar (decision 100).** It replaces the left rail: the app name, then Stories, Settings and About (spec 10). The dot that shows a missing API key stays on Settings. The version number moves to the About page.
- **Story workspace.** Under the top bar, the story's title, a way back to the bookshelf, and the Novel, Characters and Setting tabs, as before.
- **Chapter side list.** The Novel page lists the chapters vertically on the left: number and title for each ended chapter, the chapter in progress last and marked as current. Clicking an ended chapter opens it in the reader (spec 5.6); clicking the current one returns to writing. The list scrolls on its own, apart from the page, and opens scrolled to the current chapter, so a long continuous story stays usable (decision 108). Below 1100 pixels of window width the list folds into a "Chapters" button that opens it as a panel over the page and closes it after a pick.

### 12.2 Visual style

- **Colours (decision 95).** Black, white and grays only, in both themes. The main button on a page is solid black in the light theme and solid near-white in the dark one; other buttons are outlined. The one colour is a muted red, kept for errors and for actions that end or delete something (End story, Delete story). End Chapter is told apart by its icon and solid style instead of a colour (this replaces the colours of decision 64).
- **Fonts.** Literata, a serif made for reading on screen, for all Latin text, bundled with the app (two weights, regular and medium). Chinese text uses the system's fonts: a serif Chinese font when one is installed (Noto Serif CJK, Source Han Serif), otherwise the system default (Microsoft YaHei or JhengHei on Windows). Bundling Chinese fonts would add tens of megabytes.
- **Icons.** Phosphor icons (MIT). Every main action has an icon and a text label. An icon-only button has a tooltip and an accessible name, and a new user must be able to tell the main buttons apart by their icon alone (write, regenerate, end chapter, end story, read, randomize, settings, delete).
- **Bookshelf (decision 96).** The story list shows each story as a book standing on a shelf. The spine carries the title and the story type's emblem (yin-yang for cultivation, a heart for romance, a sword for fantasy, a quill for general), and each type has its own shade of gray, so types are told apart without colour. A completed story has a ribbon on its spine. The last place on the shelf is an empty book outline, "New story"; while the shelf has books there is no other New story button (decision 123). Hovering or focusing a book shows its type, language and chapter count; Delete is in the book's menu, not on the spine.
- **Shelf rows and order (decision 109).** Books fill a shelf row and wrap onto more rows below, which scroll; at 900 × 600 a row holds about 8 books. The most recently opened story comes first (a new story counts as opened when created).
- **Spine titles (decision 109).** A title in Chinese is written vertically, top to bottom, as on a printed Chinese book. Any other title is rotated 90° to read bottom to top. A title too long for the spine ends with "…" (a vertical Chinese title with "︙" after 7 characters, decision 121), and the full title shows on hover and focus.

### 12.3 Story art

- **What there is (decisions 97, 103, 112).** Each story type has one background. Three character figures (male, female and neutral) are shared by all types. The author made them with ChatGPT, and they ship with the app as fixed files:
  - `src/assets/backgrounds/<type>.webp`: grayscale, misty ink-wash scenes (3:2, about 1536 × 1024)
  - General is the exception (decision 127): a story of any genre has no one world to picture, so its background is `src/assets/backgrounds/general.svg`, an abstract ink-wash made in code: layered mist, soft brush strokes and faint paper grain in the same grays, with no place, era or object in it. It is shown and checked for contrast like the others.
  - `src/assets/figures/figure-<male|female|neutral>.png`: flat black half-body silhouettes on a transparent background, all on one 449 × 527 canvas, centred and standing on the bottom edge so they line up
- **Genre-neutral figures.** Because they stand in front of every story type's world, the figures wear plain, timeless clothing (a simple coat), hold nothing, and fit no era or culture; hair and outline tell them apart. The neutral figure has short, soft hair and a slight build.
- **Which figure.** Gender Male shows the male figure, Female the female one; Non-binary, Other and no gender show the neutral one.
- **Where.** The background sits behind the story workspace (all three tabs). On the Characters page, the character's figure sits behind the character sheet, on the right.
- **How it is shown (decision 98).**
  - Backgrounds at 60%: drawn at 60% opacity over the page colour, in both themes, with a normal blend; the image is never inverted for the dark theme. A story type may set a lower strength for its own image if it fails the contrast check below.
  - The background is fixed to the window, anchored at the bottom, and covers it; text scrolls over it. It fades out toward the top, so it is strongest where the page is usually empty (a gradient in the page colour over the image, decision 118).
  - Figures at 20% (decision 112): the PNG is used as a mask and filled with the theme's text colour (near-black in light, near-white in dark), at 20% opacity, so the outline shows as a soft gray in both themes. It stands at the bottom right of the character sheet, as tall as the sheet allows, with no fade.
  - Text directly over art has a thin halo in the page colour behind each letter; text inside panels, washes and controls has none (decision 123). Inside a story, gray secondary text is darker (lighter in the dark theme) and sits on a soft wash of the page colour at about 82%, as do the panels and the chapter side list (decision 119).
  - Input fields, dialogs and the action bar keep solid backgrounds; nothing is typed over art.
  - **Paper panel (decision 110).** On the Novel page and in the chapter reader, the story text sits on a paper panel: the reading column in the page colour at about 90% opacity, with a soft edge. The art shows in full around it, never behind the words being read. Other pages (Characters, Setting) use the halo alone.
  - **Contrast check:** body text must stay at WCAG AA (4.5:1) against the art behind it, in both themes, measured on the lightest and darkest parts of each image where text can sit. A type that fails gets a lower strength for its image only.
- **Off switch.** Settings → Appearance → Background art turns all art off; the pages then use the plain page colour.
- **Missing art.** A missing or unreadable image file shows the plain page colour; it never stops a page from loading. A test checks that every story type has its background and that all three figures exist.

### 12.4 Animation

- **What moves (decision 102):**
  - pages and tabs fade in (about 150 ms)
  - entering a story opens its book from the shelf (at most 600 ms; a click skips it)
  - a block's text fades in paragraph by paragraph as it streams
  - the background drifts very slowly (a few pixels over a minute, in small steps, decision 117)
  - the character figure breathes and sways slightly when idle; it holds still while a field on the character sheet has focus (decision 111)
- **Rules:** animation never delays reading, writing or a click. The story's files load while the book opens, and any key or click ends an animation at once. When the system asks for less motion (Windows: Settings → Accessibility → Visual effects → Animation effects off; the same setting on Linux desktops, both read through `prefers-reduced-motion`), nothing moves: pages switch at once, and the art stays still.

## 13. Background music

Phase 8 (decisions 130–137). Music is for the story's emotional peaks only. Most of the time the app is silent; a track fades in when a block reaches a peak, plays once and fades out.

### 13.1 Moods and tracks

- **Moods (decision 130).** Six moods, shared by all story types, plus `none`:

  | Mood | Used for |
  | --- | --- |
  | `tense` | A fight or capture about to break out in this very block: weapons drawn, a standoff, a chase about to start |
  | `battle` | Fights, duels, chases |
  | `reveal` | A major twist, a shocking truth, an identity exposed |
  | `sad` | Death, parting, a heavy loss |
  | `triumphant` | Victory, a breakthrough, a happy ending |
  | `romantic` | A confession, a first kiss, a big romance moment |
  | `none` | Everything else: daily life, travel, talk. The usual value |

- **The prompt.** The writing instructions list the moods with these meanings and tell the AI to pick one only when the block reaches a real emotional peak, and `none` for most blocks. They also say what is not a peak: ordinary suspense, hiding, sneaking, searching, travel, talk, clues and worry (decision 139). As a guide, about one block in four has a mood. The mood line is asked for in every story type, General included.
- **Tracks (decision 133).** One track per mood, shared by all story types, bundled with the app as `src/assets/music/<mood>.mp3` (MP3, 128 kbps, stereo). Each is instrumental, 1–3 minutes long, with a natural ending; tracks do not need to loop. The six tracks add about 18 MB to the installer. `npm run encode-music -- <files>` converts new tracks to this format with ffmpeg (the `ffmpeg-static` dev dependency, decision 136); a track already at 128 kbps or less is kept as it is.
- **Licences (decision 134).** Only tracks whose licence allows bundling them in software given away for free: CC0, CC BY, or the Pixabay Content Licence. No non-commercial (NC) or no-changes (ND) licences, and none limited to videos. Each track's title, artist, licence and source link are kept in `src/music.config.ts` and listed in the About page credits (spec 10).
- **The tracks chosen (decision 135).** All six are by Kevin MacLeod (incompetech.com), licensed under Creative Commons Attribution 4.0 (CC BY 4.0). The credit for each reads: "<title>" Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 License, http://creativecommons.org/licenses/by/4.0/

  | Mood | Title | Length |
  | --- | --- | --- |
  | `tense` | Satiate | 3:12 |
  | `battle` | Death and Axes | 2:48 |
  | `reveal` | I Can Feel it Coming | 3:35 |
  | `sad` | Lost Time | 3:47 |
  | `triumphant` | Rainbows | 3:39 |
  | `romantic` | Touching Moments Four - Melody | 1:49 |

- **Level (decision 135).** The tracks were mastered at very different loudness: battle is about 19 dB louder than romantic. Each track has a level in dB in `src/music.config.ts`, so that all of them sound about as loud as each other (measured on their loudest 10%). Battle and tense sit a further 4 dB lower, because loud, aggressive music distracts from reading. The volume played is the Volume setting times the track's level, and no track goes above full scale. Starting levels: tense −11 dB, battle −13 dB, reveal −4 dB, sad −3 dB, triumphant −4 dB, romantic +10 dB. They are tuned by ear when phase 8 is tested.
- **Missing track.** A missing or unreadable file means silence for that mood; it never stops writing. A test checks that every mood has its file and a credit entry.

### 13.2 When music plays (decision 131)

- **Play once.** When a block finishes and its mood is not `none`, its track fades in over about 6 seconds, plays to the end once, and fades out over its last 10 seconds (decision 149). Then the app is silent again.
- **The next block:**
  - mood `none`: the track playing (if any) plays on to its end
  - the same mood while its track still plays: the track plays on; it does not restart
  - the same mood after its track has ended: the track fades in again from the start
  - a different mood: the playing track crossfades into the new one over about 5 seconds
- **Regenerate.** The new version's mood is used as for a new block. The old version's track is not stopped early unless the new mood is a different peak.
- **End Chapter.** Clicking End Chapter, or End story, fades any music out over about 5 seconds. Each chapter starts in silence.
- **Epilogue.** The epilogue (spec 5.5) ends with a mood line too: `triumphant` for a happy ending, `sad` for one in loss, otherwise `none`. Its track keeps playing after the epilogue is accepted.
- **No replay.** Opening a story, reading earlier chapters (spec 5.6) and the Characters and Setting pages never start music; only a newly finished block does.
- Music changes only when a block finishes, not while it streams, since the mood line comes at the end of the answer.
- The first track plays after the user clicks Write, so the webview's autoplay rule never blocks it.

### 13.3 Pause, resume and off (decision 132)

- **Leaving the story in any way pauses the music**: going back to the bookshelf, opening Settings or About, minimising or hiding the window, or closing the app.
- **Coming back** to the same story's pages while the app is still open resumes a paused track with a fade-in of about 3 seconds, from where it stopped. A track that had ended stays silent. Closing the app forgets the paused track.
- **Music off** stops any music at once (a 0.2-second fade so it does not click). Turning it back on starts nothing; the next peak block plays as usual.
- **Volume** changes apply at once to a playing or paused track.
- The browser preview (`npm run dev`) plays music in the same way.
- The player shows its state on the page's root element as `data-music` ("battle playing", "battle paused", or empty for silence), for the E2E tests and for checking by hand.

## 14. Images

Phase 8 (decisions 68, 140–148). Pictures of the story as it is written. Off by default, since every picture costs money.

### 14.1 Levels and settings

- **Level (decision 68).** A main setting with three levels: **None** (default; no picture request is ever sent), **Lite** (one picture per chapter, made at End Chapter) and **Rich** (one picture per block, made after the block is written). Saved as `images` in `app-settings.json`.
- **Image provider (decision 140).** Its own base URL, key and model, since many text providers have no image models. It uses the OpenAI images API (`POST <base URL>/images/generations`); any provider with the same request shape works. The base URL defaults to OpenAI's and the model to `gpt-image-1-mini`. A "Same as the text AI" switch (off by default) uses the text provider's base URL and key instead. The key is kept in the OS credential store under its own name, like the text key.
- **Test image connection** lists the provider's models and checks that the chosen model is one of them. It never makes a picture, so it costs nothing. The group's own buttons are named for pictures ("Save image key", "Test image connection"), so they are not mistaken for the text AI's.
- **Size and quality (decision 141).** Pictures are landscape, 1536×1024, at a Quality setting of Low or Medium (default Low), asked for as WebP so each file stays small (about 100–300 KB).
- **Cost (decision 142).** Before the level can be set to Lite or Rich, the Images group shows the price per picture for the chosen model and quality, and per chapter for each level: Lite is one picture; Rich is the typical blocks of the default chapter length (spec 5.3). Prices are kept per model in `src/images.config.ts`, checked against the provider's price page when the app is built. A model not in the table shows "price not known, check your provider's price page".

### 14.2 What a picture shows

- **The scene line (decision 143).** The text AI describes the picture, so no extra AI call is made.
  - **Rich:** the block format (spec 6.3) gets a `PICTURE: <scene>` line after the marker, asked for only when the level is Rich. It is read like the mood line, never shown, and saved with the block version.
  - **Lite:** the End Chapter call (spec 5.4) returns a `picture` field: the chapter's key scene.
  - The scene is always in English, one or two sentences: who is there (by name), where, what is happening, the light and the mood. In a Mature story it stays non-explicit.
- **Style (decision 144).** Each story type's config sets one art style (`imageStyle`), so every picture in a story looks alike. Nothing to set. The styles (decision 148):

  | Type | Style |
  | --- | --- |
  | Cultivation | Chinese ink and colour wash painting |
  | Romance | Soft watercolour illustration in warm pastel light, like a romance novel cover |
  | Fantasy | Classic fantasy oil painting, like a painted fantasy book cover |
  | General | Monochrome pencil sketch, like an illustration in a printed novel |
- **Appearance (decision 145).** A new character field for all story types, **Appearance**: a short text on how the character looks (face, hair, build, usual clothes). Optional. Each curated set's main character comes with one. A proposed new character at End Chapter (spec 7.5) comes with one, and the AI may propose one for a character without it.
- **The picture request** joins the type's style, the scene line, and the appearance of every character the scene names, with "no text or lettering in the picture". Characters are matched by name, as for characters in the scene (spec 6.1).

### 14.3 Where pictures go

- **Rich.** The picture is requested once the block (or a regenerated version) is saved, and shown under that block when it arrives. Each version has its own picture; switching versions shows that version's. Writing the next block never waits for a picture.
- **Lite.** The picture is requested once the End Chapter call's answer is saved, and shown at the top of the chapter in the reader (spec 5.6) and in the End Chapter review. On Lite, a finished chapter with a scene but no picture offers "Make picture" in the reader.
- **Files (decision 146).** A Rich picture is saved as `draft/pictures/<key>.webp`, the key being the version's `createdAt` in digits, so no other version shares it; the version in `draft.json` keeps only its scene line. Whether a picture is drawing or failed is kept in memory, never in a file. When the chapter is finished (spec 5.4 step 4, or the epilogue accepted), the chosen versions' pictures are copied to `chapters/<n>/pictures/<block>.webp`, with `pictures.json` giving each one's place as the paragraph of `chapter.md` that ends its block; `draft/pictures/` is then deleted with the dropped versions' files. A Lite picture is `chapters/<n>/picture.webp`. Pictures are never sent back to the text AI.
- **Turning images off** (or down to Lite) keeps every saved picture, and they are still shown. Only new requests stop.
- **While drawing,** the place of the picture shows "Drawing…" with a spinner. Leaving the story lets a picture request finish and save in the background.

### 14.4 Errors (decision 147)

- A refused or failed picture never blocks writing, and never changes the story text or the draft's blocks.
- In its place it says why in plain words, with a Try again button: refused by the provider's safety rules (suggests leaving it or retrying), wrong key, no credit, rate limit, no connection, wrong model name. The wording is the same as for text errors (spec 9), with the provider's own message after ours.
- On Rich, a block with no `PICTURE:` line (or one written while pictures were off) gets no picture and no error; its place shows a "Make picture" button that uses the block text, cut to its last 600 characters, as the scene. A Lite chapter with no scene uses its summary.
- Development builds log every picture request in `ai-log/` like a block request: the time, outcome, model, size, quality and the prompt as sent. The picture itself and the key are never written to the log.
