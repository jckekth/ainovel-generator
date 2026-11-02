# Phase 5c: Linux build

**Status:** In progress
**Spec sections:** 1, 2, 3, 9

## Goal

The same app runs on Linux, installed from a `.deb` package or run from an AppImage, with the API key kept in the system keyring (decisions 92, 93).

## Tasks

- [x] Linux bundle targets in `tauri.conf.json`: `deb` and `appimage` beside `nsis` *(each OS builds only its own packages)*
- [x] A key store that cannot be reached gives a plain-words message saying what to install or unlock (decision 93)
- [x] The app still opens when the key cannot be read at startup
- [x] Build steps for Linux in `README.md`
- [x] A GitHub Actions workflow that builds the `.deb`, the AppImage and the Windows installer (decision 155)
- [ ] Build the `.deb` and AppImage with that workflow (or on Linux or in WSL2) and download them
- [ ] Install and run on a Linux desktop (Ubuntu with GNOME is the first target)

## Acceptance checks

- [ ] `npm run tauri build` on Linux makes a `.deb` and an AppImage.
- [ ] The `.deb` installs on Ubuntu, and the app starts from the applications menu.
- [ ] The AppImage starts on a second distribution (for example Fedora or Linux Mint) after `chmod +x`.
- [ ] Saving an API key shows "Key saved", and the key appears in the keyring (GNOME: the Passwords and Keys app, under `ai-novel-generator`). It is still there after a restart.
- [ ] With no keyring running, saving a key shows the message about the password store, and the app still opens and lists stories.
- [ ] Writing a block, End Chapter and "Open data folder" work; story files land in `~/.local/share/ainovelgenerator`.
- [ ] Fonts, the Chinese UI and the dark theme look right in the Linux webview (WebKitGTK).
- [ ] The Windows installer still builds and works as in phase 5.

## How to check

- **Build:** on Ubuntu 22.04 or newer (or WSL2 with Ubuntu), install the packages listed in `README.md` under "Build for Linux", then `npm install` and `npm run tauri build`. The packages are in `src-tauri/target/release/bundle/deb/` and `bundle/appimage/`.
- **Install:** `sudo apt install ./AI\ Novel\ Generator_0.1.0_amd64.deb`; remove it with `sudo apt remove ai-novel-generator`. The data folder should still be there afterwards.
- **No keyring:** log in to a desktop without a keyring (for example a plain window manager session), or stop it with `pkill gnome-keyring-d`, then save a key in Settings.
- **Mock AI:** `npm run mock-ai` works the same on Linux for the writing checks.
