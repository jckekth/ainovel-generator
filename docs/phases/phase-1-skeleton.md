# Phase 1: Skeleton

**Status:** Done (2026-10-06)
**Spec sections:** 2, 3, 9

## Goal

A running app where the user can manage stories and set up the AI connection. No story content yet.

## Tasks

- [x] Tauri 2 + React + TypeScript project files
- [x] Rust commands for the API key in the OS credential store
- [x] Tauri capabilities: app data files, HTTP, open folder
- [x] App icons
- [x] File storage layer with Tauri and browser implementations
- [x] Global settings: load, save, apply font size and theme
- [x] Story list: create (title, type, language), open, delete with confirmation
- [x] Story workspace with Novel, Characters and Setting tabs (placeholders)
- [x] Settings page: API key, base URL, test connection, model, context budget, font size, theme, open data folder
- [x] First-launch guide on the Settings page
- [x] `npm install` succeeds on Windows
- [x] `npm run tauri dev` compiles and opens the window
- [x] `npm run build` passes the TypeScript check

## Acceptance checks

Run these in the real app (`npm run tauri dev`).

- [x] On first launch the app opens on Settings and shows the guide.
- [x] Saving an API key shows "Key saved", and the key appears in Windows Credential Manager under `ai-novel-generator`.
- [x] After closing and reopening the app, the key is still saved and the guide is gone.
- [x] Test connection with a valid key reports the number of models, and the Model field lists them.
- [x] Test connection with a wrong key says the key was rejected.
- [x] Changing font size, theme and context budget takes effect at once and survives a restart.
- [x] "Open data folder" opens the folder in File Explorer, and `app-settings.json` is in it without the API key.
- [x] Creating a story opens its workspace, and a `stories/<id>/story.json` file exists on disk.
- [x] The story list shows the story after a restart.
- [x] Deleting a story removes its card and its folder.

## Notes

- All acceptance checks passed in the real app on Windows on 2026-10-06, using the mock API (`npm run mock-ai`, see `scripts/mock-ai-server.mjs`) for the connection checks.
- Fixed during testing: Settings showed a second window scrollbar in small windows. The hidden radio inputs in `.choice` and `.seg` were positioned against the window; those now have `position: relative`.
