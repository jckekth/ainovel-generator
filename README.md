# AI Novel Generator

A desktop app for Windows and Linux that writes an interactive novel with an AI API. Built with Tauri 2, React and TypeScript.

The spec, decisions and progress tracker are in [docs/](docs/README.md). Current status: [docs/progress.md](docs/progress.md). How the app is designed and built, in plain words: [docs/design-overview.md](docs/design-overview.md).

Version 0.3.0, alpha. Home page, downloads and bug reports: https://jc-do-things.itch.io/ai-novel-generator-tool

## What the app does

You set up a world and its characters, the AI writes the story a few paragraphs at a time, and after each part you decide what happens next. The story is split into chapters; at the end of each chapter the AI sums it up and proposes changes to your characters, which you accept or turn down.

| Feature | What it means for you |
| --- | --- |
| Your own AI key | The app uses any OpenAI-compatible service (OpenAI, DeepSeek, OpenRouter, a local model…). You pay that service for what you use; the app itself is free. |
| Four story types | Cultivation, Romance, Fantasy and General. Each has its own setting and character fields, and ready-made worlds you can pick with Randomize. |
| Three languages | The app's screens, and the novel itself, can be in English, 简体中文 or 繁體中文. The two are separate choices. |
| Steering | After each block: pick one of the suggested actions, write your own direction, or regenerate the block with a hint. |
| Chapters | Word counts and a progress bar show when a chapter is long enough. End Chapter saves it, writes a summary and reviews character changes. Earlier chapters can be read at any time. |
| Flat cost | Each AI request sends summaries, not the whole book, so a request in chapter 20 costs about the same as one in chapter 2. Tokens used are shown per block and per chapter. |
| Music | Optional. A short track plays when the story reaches an emotional peak (a battle, a reveal, a farewell), then the app is quiet again. |
| Pictures | Optional and off by default, since each picture costs money. Lite makes one picture per chapter, Rich one per block. Settings shows the price first. |
| Your files | Every story is a folder of readable markdown files on your computer. Nothing is sent anywhere except to the AI service you chose. The API key is kept in Windows Credential Manager (or the Linux keyring), never in a file. |

## Alpha testing

Thank you for testing. This section is for testers; the sections after it are for building the app from source.

### Install

- **Windows 10 or 11:** run `AI Novel Generator_<version>_x64-setup.exe`. It installs for your user only, with no administrator prompt. The installer is not code-signed yet, so Windows SmartScreen may warn you; choose "More info", then "Run anyway".
- **Linux (Ubuntu 22.04 or newer):** `sudo apt install ./<file>.deb`, or make the AppImage runnable with `chmod +x` and start it. You need a keyring (GNOME Keyring or KWallet) to save the API key. Linux builds are less tested than Windows.

### Before you start

You need an API key from an AI provider, with some credit on it. On first launch the app opens Settings with a setup guide: pick a provider, create a key on its site, paste it, click **Test connection**, then pick a model. What a chapter costs depends on the model and the provider's prices; the token counts in the app show what each block and chapter used.

Leave **Pictures** on None unless you want to test pictures: they are billed per picture.

### What to try

A first session of 30–60 minutes covers most of the app:

1. **Set up.** Settings: save your key, test the connection, choose a model. Try the theme, font size and UI language.
2. **Make a story.** On the bookshelf click **New story**, choose a type and a novel language. On the Setting tab try **Randomize**, change a few fields and save. On the Characters tab check the main character and add one more character.
3. **Write.** On the Novel tab write a few blocks. Use a suggested action, then your own direction, then **Regenerate** with a hint and switch between the versions. Try **Stop** while a block is being written.
4. **End a chapter.** When the progress bar is full, click **End Chapter**. Read the summary, accept or turn down the character changes, and start chapter 2. Open chapter 1 from the chapter list.
5. **Leave and come back.** Close the app in the middle of a chapter and open it again: the chapter should be where you left it.
6. **Extras, if you have time:** music on and off, a story in a different novel language, a second story type, End story and the epilogue, pictures on Lite.

### What feedback helps most

- Anything that lost your text or left the app stuck.
- Error messages that did not tell you what to do next.
- How the story reads: does it follow your directions, keep the characters' names and facts straight, and sound natural in your language?
- Anything confusing on first use: where you hesitated, or a button you could not find.
- Your provider and model, and roughly what a chapter cost you.

### How to report

Post on the app's itch.io page (https://jc-do-things.itch.io/ai-novel-generator-tool), or email jc.do.things@gmail.com (also on the About page, with a Copy button). Please include:

- what you did, what you expected and what happened instead
- the app version (on the About page), Windows or Linux, and the UI and novel language
- a screenshot if you can

If a story looks wrong, you can attach its folder: Settings → **Open data folder** → `stories/`. The folders hold your story text but never your API key. On Windows the data folder is `%APPDATA%\ainovelgenerator`.

### Known limits in this alpha

- Desktop only (Windows and Linux); no phone layout.
- No export or sharing of stories yet; back up a story by copying its folder.
- You cannot rewind to an earlier chapter.
- Pictures have only been tried with OpenAI's `gpt-image-1-mini`.
- Uninstalling keeps your stories in the data folder; delete it by hand if you want them gone.

## What you need installed (Windows)

1. **Node.js** 20 or newer: https://nodejs.org
2. **Rust**: https://rustup.rs (run the installer, accept the defaults)
3. **Microsoft C++ Build Tools**, with the "Desktop development with C++" workload:
   https://visualstudio.microsoft.com/visual-cpp-build-tools/
4. **WebView2**: already part of Windows 10 and 11.

On Linux, see [Build for Linux](#build-for-linux).

## Run it

Open a terminal in this folder, then:

```
npm install
npm run tauri dev
```

The first run downloads and compiles the Rust dependencies, which takes several minutes. Later runs start in seconds.

To preview only the UI in a browser, without the Tauri shell:

```
npm run dev
```

Then open http://localhost:1420. In this mode stories are kept in the browser's storage and the API key only lasts until the tab closes.

## Run the tests

```
npm test            # unit tests (fast)
npm run test:e2e    # end-to-end tests in Edge, against the browser preview
npm run test:all    # type check, build, unit and end-to-end
```

| Layer | Tool | What it checks |
| --- | --- | --- |
| Types | `tsc` (part of `npm run build`) | The whole of `src/`, tests included |
| Unit | Vitest, in Node with jsdom | Every rule in `src/lib/`: files, prompt, parsing, limits, End Chapter, music, pictures |
| Config | Vitest | The story type and curated set JSON files are well formed and match the spec |
| End to end | Playwright, in Microsoft Edge | User flows in the browser preview against the mock AI server, which Playwright starts for you |
| Real app | By hand | What only the installed app can do: the credential store, real files, Open data folder, the installer. The acceptance checks are in each [phase file](docs/phases/). |

No automated test calls a real AI. What each layer covers, and what each phase should add: [docs/testing.md](docs/testing.md).

### Test by hand without a real key

The mock AI server answers like an OpenAI-compatible API, for free:

```
npm run mock-ai     # in one terminal: fake API on port 8787
npm run dev         # in another: the app at http://localhost:1420
```

In Settings set the base URL to `http://127.0.0.1:8787/v1`, any model name (for example `mock-gpt-large`), and one of the test keys. Each key makes the server answer a different way:

| Key | What happens |
| --- | --- |
| `sk-test-valid` | Normal blocks. A direction that names a mood ("a battle") gets that mood's music |
| `sk-test-stream-slow` | A block streamed over about 15 seconds, to try Stop |
| `sk-test-stream-long` | Blocks of about 800 words, to reach the chapter limit fast |
| `sk-test-stream-died` | The main character dies in the block |
| `sk-test-stream-error` | The connection drops halfway through a block |
| `sk-test-end-chapter-fail` | End Chapter fails, so its retry can be tried |
| `sk-test-rate-limit`, `sk-test-no-credit`, `sk-test-forbidden`, `sk-test-server-error` | The plain-words error messages |
| `sk-test-image-refused`, `sk-test-image-slow`, `sk-test-image-error` | Picture errors. In Settings → Pictures choose Lite or Rich, save one of these as the image key, set the image base URL to the mock's and the image model to `mock-image-1`; `sk-test-valid` there gives working pictures |
| any other key | 401, wrong key |

The full list, with what each key is for, is at the top of [scripts/mock-ai-server.mjs](scripts/mock-ai-server.mjs).

In development builds every AI call is saved as a readable file in the story's `ai-log/` folder (in the browser preview: localStorage keys `ang-file:stories/<id>/ai-log/…`), so you can see each prompt exactly as sent. Installed builds write no log.

To check Tauri-only behaviour, run `npm run tauri dev` with the same mock settings, or install a build from `npm run tauri build`.

### Before an alpha build

1. `npm run test:all` passes.
2. The open acceptance checks in [docs/progress.md](docs/progress.md) are known and accepted.
3. Prices in `src/images.config.ts` still match the provider's price page.
4. `npm run tauri build`, then install the setup file on a clean user account and run the first-session steps under [What to try](#what-to-try) with a real key.

## Build the installer

```
npm run tauri build
```

The installer is one file, written to `src-tauri/target/release/bundle/nsis/AI Novel Generator_<version>_x64-setup.exe`. It installs for the current user, with no administrator prompt. Uninstalling keeps the stories in the data folder.

The same command on Linux makes a `.deb` and an AppImage instead (decision 92); each system builds only its own packages.

## Build on GitHub

The easiest way to get the Linux packages without a Linux machine. [.github/workflows/build.yml](.github/workflows/build.yml) builds the `.deb` and AppImage on Ubuntu 22.04 and the setup `.exe` on Windows, after the unit tests pass (decision 155).

- **By hand:** on GitHub, open the repository's **Actions** tab → **Build installers** → **Run workflow**. When the run finishes (the first run can take 15 minutes or more; later runs reuse a cache), download `ai-novel-generator-linux` and `ai-novel-generator-windows` from the run's **Artifacts**. Each download is a zip holding the packages.
- **For a release:** push a version tag, for example `git tag v0.3.1` and `git push origin v0.3.1` (set the same version in `package.json` and `src-tauri/Cargo.toml` first). The run then also makes a **draft** release on GitHub with the files attached; check them, then upload them to itch.io or publish the release.

The packages are not code-signed, so Windows SmartScreen may warn about the installer.

## Build for Linux

Tauri cannot build Linux packages from Windows, so build on GitHub (above), on a Linux machine or in WSL2 (`wsl --install` gives Ubuntu). On Ubuntu 22.04 or newer:

```
sudo apt update
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev pkg-config
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Install Node.js 20 or newer (for example from https://nodejs.org or with `nvm`), then run `npm install` and `npm run tauri build` in this folder. The packages are written to:

- `src-tauri/target/release/bundle/deb/AI Novel Generator_<version>_amd64.deb`: install with `sudo apt install ./<file>.deb`.
- `src-tauri/target/release/bundle/appimage/AI Novel Generator_<version>_amd64.AppImage`: make it runnable with `chmod +x`, then start it.

On Linux the API key is kept in the desktop's keyring (GNOME Keyring or KWallet), and stories are in `~/.local/share/ainovelgenerator`. Desktops without a keyring cannot save the key; the app says what to install.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/lib/platform.ts` | Tells the Tauri app from the browser preview; opens a folder |
| `src/lib/storage.ts` | File storage: real files in the app, browser storage in preview |
| `src/lib/secrets.ts` | API key, kept in the OS credential store (Windows Credential Manager, or the keyring on Linux) |
| `src/lib/settings.ts` | Global settings (`app-settings.json`) |
| `src/lib/stories.ts` | Create, list and delete stories |
| `src/lib/ai.ts` | Calls to the OpenAI-compatible API: list models, streamed chat |
| `src/lib/prompt.ts` | Builds the prompt for a block from capped layers (spec 6) |
| `src/lib/scene.ts` | Which characters are in the scene (name matching) |
| `src/lib/block.ts` | Splits the AI's answer into story text, suggested actions and the died flag |
| `src/lib/draft.ts` | The chapter in progress (`draft/draft.json`): blocks and regenerate versions |
| `src/lib/novel.ts` | Writes one block or the epilogue: prompt, stream, parse, save |
| `src/lib/length.ts` | Word counts, chapter limits, story length pacing |
| `src/lib/tokens.ts` | Tokens each AI call used: the provider's report, or an estimate (spec 6.6) |
| `src/lib/languageStyle.ts` | Native-prose notes for novels not written in English (spec 6.5) |
| `src/lib/unsent.ts` | Typed but unsent direction and hint, kept in memory |
| `src/lib/chapters.ts` | Finished chapters, summaries, snapshots, the story so far |
| `src/lib/endChapter.ts` | End Chapter call, the review of character changes, the story's ending |
| `src/lib/errors.ts` | Turns system errors (read-only folder, full disk) into plain words |
| `src/lib/devlog.ts` | Development builds only: saves every AI call to `stories/<id>/ai-log/` |
| `src/lib/mood.ts`, `src/lib/music.ts`, `src/music.config.ts` | Moods the AI can give a block, the music player, and each track's credit and level (spec 13) |
| `src/lib/pictures.ts`, `src/images.config.ts` | Picture requests, where picture files live, sizes and prices (spec 14) |
| `src/lib/art.ts` | Background art per story type and the character figures (spec 12.3) |
| `src/about.config.ts` | About page values: author, contact, itch.io address |
| `src/assets/` | Bundled backgrounds, figures and music |
| `src/lib/storyTypes.ts` | Story types and novel languages |
| `src/storyTypes/*.json` | Story type configs: the fields, rules and prompt fragments of each genre |
| `src/storyTypes/sets/*.json`, `src/lib/curatedSets.ts` | Curated sets: ready-made worlds, main characters and name pools per type, in three languages |
| `src/i18n/` | UI texts in English, 简体中文 and 繁體中文, and `t()` (spec 11) |
| `src/lib/fields.ts` | Field definitions, defaults and validation for the generated forms |
| `src/lib/markdoc.ts` | Markdown files with a YAML header (setting and characters) |
| `src/lib/setting.ts` | `setting.md` and `notes.md` |
| `src/lib/characters.ts` | Character files and the main character rules |
| `src/components/FieldForm.tsx` | Builds a form from story type fields |
| `src/components/ProgressDialog.tsx` | Spinner dialog with the current step, for End Chapter and the epilogue |
| `src/pages/` | Story list, story workspace (Novel, Characters and Setting tabs, chapter review), settings |
| `scripts/mock-ai-server.mjs` | Fake API for testing without a real key (`npm run mock-ai`) |
| `src/lib/*.test.ts`, `src/test/` | Unit and story type config tests (Vitest) |
| `e2e/` | End-to-end tests (Playwright) |
| `src-tauri/src/lib.rs` | Rust side: plugins and the API key commands |
| `src-tauri/capabilities/default.json` | What the app window is allowed to do |

Story data is saved in the app's data folder. Settings has an "Open data folder" button.
