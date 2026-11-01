/**
 * File storage for the whole app.
 *
 * Every path is relative to the app's data folder and uses forward slashes,
 * for example "stories/my-story-ab12/story.json".
 *
 * Two implementations sit behind the same interface:
 *  - Tauri: real files in the app data folder, DATA_FOLDER inside the system's
 *    data folder (%APPDATA% on Windows, ~/.local/share on Linux, decision 154).
 *  - Browser: localStorage, so the UI can be developed with `npm run dev`
 *    without the Tauri shell. It is a development aid, not a shipping target.
 */
import { isTauri } from "./platform";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileStore {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  /** Binary files, such as pictures (spec 14.3). */
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Lists the direct children of a folder. A missing folder gives an empty list. */
  list(path: string): Promise<DirEntry[]>;
  /** Removes a file, or a folder with everything in it. */
  remove(path: string): Promise<void>;
  /** Absolute path of the data folder, or null where there is none (browser). */
  rootPath(): Promise<string | null>;
}

/** The data folder's name. Not the bundle identifier, so testers can find and type it (decision 154). */
export const DATA_FOLDER = "ainovelgenerator";

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

class TauriStore implements FileStore {
  private fs = import("@tauri-apps/plugin-fs");

  private async base() {
    const fs = await this.fs;
    return { fs, opt: { baseDir: fs.BaseDirectory.Data } };
  }

  /** A store path as a path under the system's data folder. */
  private at(path: string) {
    return path === "" ? DATA_FOLDER : `${DATA_FOLDER}/${path}`;
  }

  async readText(path: string) {
    const { fs, opt } = await this.base();
    return fs.readTextFile(this.at(path), opt);
  }

  async writeText(path: string, content: string) {
    const { fs, opt } = await this.base();
    // The data folder itself may not exist on first launch, so always make the parent.
    await fs.mkdir(this.at(parentOf(path)), { ...opt, recursive: true });
    await fs.writeTextFile(this.at(path), content, opt);
  }

  async readBytes(path: string) {
    const { fs, opt } = await this.base();
    return fs.readFile(this.at(path), opt);
  }

  async writeBytes(path: string, content: Uint8Array) {
    const { fs, opt } = await this.base();
    await fs.mkdir(this.at(parentOf(path)), { ...opt, recursive: true });
    await fs.writeFile(this.at(path), content, opt);
  }

  async exists(path: string) {
    const { fs, opt } = await this.base();
    return fs.exists(this.at(path), opt);
  }

  async list(path: string) {
    const { fs, opt } = await this.base();
    if (!(await fs.exists(this.at(path), opt))) return [];
    const entries = await fs.readDir(this.at(path), opt);
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }));
  }

  async remove(path: string) {
    const { fs, opt } = await this.base();
    if (await fs.exists(this.at(path), opt)) await fs.remove(this.at(path), { ...opt, recursive: true });
  }

  async rootPath() {
    const { dataDir, join } = await import("@tauri-apps/api/path");
    return join(await dataDir(), DATA_FOLDER);
  }
}

const PREFIX = "ang-file:";

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

class BrowserStore implements FileStore {
  private keys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }

  async readText(path: string) {
    const v = localStorage.getItem(PREFIX + path);
    if (v === null) throw new Error(`File not found: ${path}`);
    return v;
  }

  async writeText(path: string, content: string) {
    localStorage.setItem(PREFIX + path, content);
  }

  // Binary files are kept as base64 text; the mock AI's pictures are tiny.
  async readBytes(path: string) {
    return base64ToBytes(await this.readText(path));
  }

  async writeBytes(path: string, content: Uint8Array) {
    localStorage.setItem(PREFIX + path, bytesToBase64(content));
  }

  async exists(path: string) {
    return (
      localStorage.getItem(PREFIX + path) !== null ||
      this.keys().some((k) => k.startsWith(path + "/"))
    );
  }

  async list(path: string) {
    const prefix = path === "" ? "" : path + "/";
    const seen = new Map<string, boolean>();
    for (const k of this.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) seen.set(rest, false);
      else seen.set(rest.slice(0, slash), true);
    }
    return [...seen].map(([name, isDirectory]) => ({ name, isDirectory }));
  }

  async remove(path: string) {
    for (const k of this.keys()) {
      if (k === path || k.startsWith(path + "/")) localStorage.removeItem(PREFIX + k);
    }
  }

  async rootPath() {
    return null;
  }
}

export const store: FileStore = isTauri() ? new TauriStore() : new BrowserStore();

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await store.readText(path)) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await store.writeText(path, JSON.stringify(value, null, 2));
}
