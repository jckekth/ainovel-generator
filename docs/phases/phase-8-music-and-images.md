# Phase 8: Music and images (alpha)

**Status:** Done (2026-11-01, on the user's word)
**Spec sections:** music: 6.3, 9, 13 (decisions 130–139); images: 14 (decisions 68, 140–148)

## Goal

The full experience for the alpha test: background music at the story's emotional peaks, and pictures of the story as it is written.

## Tasks

- [x] Six free-licence tracks from the user (received and converted to 128 kbps MP3 on 2026-10-31, 18 MB, in `src/assets/music/`), each with its level (decision 135); credits in `src/music.config.ts` and on the About page (spec 13.1)
- [x] A mood line in the block format, read and saved with the block, `none` when missing (spec 6.3); the prompt asks for a mood only at peaks
- [x] Music player: fade in, play once, fade out; crossfade on a new mood; fade out on End Chapter (spec 13.2)
- [x] Pause when the story is left in any way, resume on return (spec 13.3)
- [x] Music settings: on or off, volume (spec 9)
- [x] Mock AI server writes a mood line
- [x] Music unit and E2E tests (docs/testing.md, phase 8: music)
- [x] Image generation setting in main settings: None (default), Lite (one picture per chapter), Rich (one picture per block) (decision 68)
- [x] Image provider settings of its own (base URL, key, model), since many text providers have no images; test connection
- [x] A character "Appearance" field, sent with every picture request so characters look the same from picture to picture
- [x] Pictures saved in the story folder, shown under their block or chapter, and kept when the setting is turned off
- [x] A refused or failed picture never blocks writing; it says why in plain words and offers a retry
- [x] Cost shown before turning images on (per picture and per chapter, by level)
- [x] Unit and E2E tests; mock AI server answers image requests (docs/testing.md, phase 8: pictures)

## Acceptance checks

- [x] Over a chapter, most blocks are silent, and a peak block (such as a fight or a death) brings in its track, which plays once and fades out.
- [x] Leaving the story in any way pauses the music, and coming back resumes it; turning music off stops it at once.
- [x] After testing "play once", the user decides whether to keep it or hold the track while the mood stays the same (decision 131).
- [x] With images on None, no picture request is ever sent.
- [x] Lite gives one picture per chapter and Rich one per block, and each picture shows the scene it belongs to.
- [x] A character looks recognisably the same in pictures from different chapters.
- [x] A refused picture (for example a Mature scene) leaves the story and the draft unchanged.
- [x] The installer stays a single file, and its size with music is agreed with the user. (Size agreed on 2026-11-01: about 18 MB for music, nothing for pictures; the single file still to check in a build.)

## How to check

Music: with the mock AI (`npm run mock-ai`) and `npm run dev`, write blocks until one has a peak mood. Check the fade in, the single play and the fade out. Then leave the story and return, and turn music off while a track plays. Then write a chapter with a real AI and listen for how often music comes in.

Images: with the mock AI, set the level to Rich and write blocks; each gets a picture under it. Then Lite and End Chapter. Then a few chapters with a real image key, checking that a named character looks the same.
