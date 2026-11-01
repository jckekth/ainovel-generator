# Phase 5: Polish and installer

**Status:** Built, not verified
**Spec sections:** 6.2, 9

## Goal

The app is ready to hand to another person: budgets work, errors are clear, and it installs from one file.

## Tasks

- [x] Context budget levels (Lean, Balanced, Rich) applied in the prompt builder *(built in phases 3–4; measured by tests in this phase)*
- [x] Content rating applied in the writing instructions *(built in phase 3)*
- [x] Prompt order arranged so the stable parts can be cached *(built in phase 3, decision 41; per-block parts are last)*
- [x] Error messages reviewed for every AI and file failure, with the provider's own message (decision 56)
- [x] Warn before leaving a story with unsaved Setting edits (from Known gaps)
- [x] Setup guide dialog on Settings: provider key links, base URL buttons; opens on first launch and from a Setup guide button (spec 9, decisions 81, 82)
- [ ] First-launch guide reviewed with a real new user *(needs a person who has not seen the app)*
- [x] Empty and loading states on every page *(story list and chapter reader were missing a loading state)*
- [ ] Tune chapter length and block size numbers from real output *(needs real stories; the `ai-log/` files show the counts)*
- [x] Windows installer with `npm run tauri build` *(one NSIS setup file, current user, decision 55)*
- [ ] Install and run on a second Windows machine

## Acceptance checks

- [ ] Switching the budget from Lean to Rich changes the size of the request as the spec's table describes.
- [ ] A ten-chapter story stays consistent, and the request size at chapter 10 is close to that at chapter 2.
- [ ] Every error the app can show names what went wrong and what to do next.
- [ ] The installer installs the app on a clean Windows machine, and the app starts from the Start menu.
- [ ] Uninstalling removes the app; story data in the data folder is left in place.

## How to check

- **Checks 1–2 (request size):** automated with realistic layer sizes (testing.md, "request size"). To see it on a real story, compare the size of the `ai-log/` files of blocks in chapter 2 and chapter 10, and of one block written with Lean and with Rich.
- **Check 3 (errors):** E2E-21 covers every error the mock can produce. In the real app, also try a wrong model name (the message points to the model name and adds the provider's words) and the network off.
- **Checks 4–5 (installer):** copy `src-tauri/target/release/bundle/nsis/AI Novel Generator_0.1.0_x64-setup.exe` to a second Windows PC, install it (no administrator prompt), start the app from the Start menu, write a block, then uninstall from Settings → Apps. The data folder (`%APPDATA%\ainovelgenerator`) should still be there. The API key is in Windows Credential Manager and is not removed by the uninstaller.
