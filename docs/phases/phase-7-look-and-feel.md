# Phase 7: Look and feel (v0.3)

**Status:** Done
**Spec sections:** 1, 4, 7.6, 8.5, 9, 10, 12 (decisions 69, 79, 80, 94–123)

## Goal

The app looks like a place to read and write stories, not a form: a new layout and visual style, art for every story type, a third story type and simple animation.

## Tasks

- [x] Top navigation bar with Stories, Settings and About, in place of the left rail; the version moves to About (spec 12.1, decision 100)
- [x] About page with its values in `src/about.config.ts` (JC Do Things, jc.do.things@gmail.com, decision 107; home page https://jc-do-things.itch.io/ai-novel-generator-tool): credits, the contact email with a Copy button, and a Home page button that opens the itch.io page in the default browser; the installer build stops while a placeholder is left (spec 10, decisions 79, 80, 94)
- [x] Chapter side list on the Novel page, scrolling on its own and opening at the current chapter, folding into a "Chapters" button below 1100 pixels (spec 12.1, decision 108)
- [x] Choose one visual direction with the user: the classic serif look in black, white and gray, Literata, Phosphor icons (decision 95)
- [x] Apply the style to every page and both themes: colours, fonts, icons with labels, one muted red for errors and destructive actions (spec 12.2)
- [x] Story list as books on a shelf, told apart by emblem and shade of gray; rows that wrap and scroll, most recently opened first, vertical Chinese spine titles (spec 12.2, decisions 96, 109)
- [x] Backgrounds for each story type: made by the author with ChatGPT, in `src/assets/backgrounds/` (decision 97)
- [x] Character figures, male, female and neutral, shared by all story types and genre-neutral: cut from the author's ChatGPT sheet into `src/assets/figures/figure-<gender>.png` (decisions 99, 103, 112)
- [x] Show the art: backgrounds at 60%, fixed with a fade; figures at 20% in the text colour behind the character sheet (decision 112); text halo, paper panel behind the story text (decision 110), solid fields, contrast check per type, Background art switch in Settings (spec 12.3, decision 98)
- [x] Fantasy story type: setting and character fields (spec 7.6, 8.5, decisions 101, 104–106): optional adventurer ranks, a required text box for class Other, a setting-list choice field for race and rank, four curated sets with main characters and name pools in three languages, prompt fragments, translations
- [x] Simple animation: page and tab fades, the book opening, streaming text fading in, background drift, idle figures that hold still while a field has focus; nothing moves with reduced motion (spec 12.4, decision 102)
- [x] Unit, config contract and E2E tests

## Acceptance checks

- [x] Every page works in the new layout at the smallest window size (900 × 600), in the light and dark theme, in all three UI languages.
- [x] A new user can tell the main buttons apart by their icon alone.
- [x] A fantasy story can be created and written to the end with no typing beyond directions, like the other types.
- [x] Every story type has its own background; each gender shows the right figure, and the figures look at home in all three types' worlds.
- [x] Text over art reads easily in a full chapter, in both themes, for every story type; with Background art off, no art is shown.
- [x] Animations never delay writing or reading, and stop when reduced motion is set.
- [x] The About page shows the right version, author and credits; Copy puts the contact email on the clipboard and the Home page button opens the default browser, in the real app and the installed build.

## How to check

Run `npm run mock-ai` and use the mock keys (docs/testing.md).

1. Resize the window to 900 × 600. Visit the bookshelf, a story (Novel, Characters, Setting), the review, Settings, the setup guide and About, in light and dark and in each UI language: nothing is cut off or overlaps, and the chapter list is behind the "Chapters" button.
2. Show the main buttons to someone who has not used the app, with their labels covered: they can say what each does.
3. Create a fantasy story without typing: the setting and main character come from a curated set. Write blocks with the suggested actions, end chapters, and end the story with an epilogue.
4. Open a story of each type: its own background is behind every tab. Create characters with each gender: Male, Female, and Non-binary, Other or none show the male, female and neutral figure, and none looks out of place in a cultivation, romance or fantasy story.
5. Write a long chapter in each type, in light and dark: the last lines on the page read as easily as the first. Turn Background art off in Settings: the pages are plain.
6. Turn on reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects off) and reopen the app: pages switch at once, the book does not open, the art does not move. With it off, click during the book opening: the story is there at once.
7. In the installed build, open About: the version matches the installer; click Copy next to the email and paste it somewhere: the address is right. Click Home page: it opens in the default browser. Build the installer with a placeholder left in `src/about.config.ts`: the build stops and names it.
