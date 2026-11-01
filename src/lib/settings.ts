/** Global settings, saved as app-settings.json. The API key is NOT stored here (see secrets.ts). */
import { detectLocale, isLocale, Locale } from "../i18n";
import { readJson, store, writeJson } from "./storage";

export type ContextBudget = "lean" | "balanced" | "rich";
export type Theme = "light" | "dark";
/** Spec 14.1: None sends no picture request; Lite makes one per chapter, Rich one per block. */
export type ImageLevel = "none" | "lite" | "rich";
export type ImageQuality = "low" | "medium";

export interface AppSettings {
  baseUrl: string;
  model: string;
  contextBudget: ContextBudget;
  fontSize: number;
  theme: Theme;
  /** The UI language (spec 11); separate from each story's language. */
  uiLanguage: Locale;
  /** The story type backgrounds and character figures (spec 12.3); off shows the plain page. */
  backgroundArt: boolean;
  /** Background music at the story's emotional peaks (spec 13). */
  music: boolean;
  /** Music volume, 0–100 (spec 9). */
  musicVolume: number;
  /** Pictures of the story (spec 14.1). */
  images: ImageLevel;
  /** The image provider (decision 140); its key is in the credential store. */
  imageBaseUrl: string;
  imageModel: string;
  imageQuality: ImageQuality;
  /** Uses the text AI's base URL and key for pictures too. */
  imageSameAsText: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  contextBudget: "balanced",
  fontSize: 17,
  theme: "light",
  uiLanguage: "en",
  backgroundArt: true,
  music: true,
  musicVolume: 50,
  images: "none",
  imageBaseUrl: "https://api.openai.com/v1",
  imageModel: "gpt-image-1-mini",
  imageQuality: "low",
  imageSameAsText: false,
};

export const FONT_SIZE_MIN = 13;
export const FONT_SIZE_MAX = 26;

const FILE = "app-settings.json";

export async function loadSettings(): Promise<AppSettings> {
  // Until a language is chosen, it follows the system language (spec 11).
  const fresh = { ...DEFAULT_SETTINGS, uiLanguage: detectLocale() };
  if (!(await store.exists(FILE))) return fresh;
  try {
    // Merge over the defaults so a settings file from an older version still loads.
    const loaded = { ...fresh, ...(await readJson<Partial<AppSettings>>(FILE)) };
    if (!isLocale(loaded.uiLanguage)) loaded.uiLanguage = fresh.uiLanguage;
    if (typeof loaded.backgroundArt !== "boolean") loaded.backgroundArt = true;
    if (typeof loaded.music !== "boolean") loaded.music = true;
    const volume = Number(loaded.musicVolume);
    loaded.musicVolume = Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : DEFAULT_SETTINGS.musicVolume;
    if (!["none", "lite", "rich"].includes(loaded.images)) loaded.images = "none";
    if (!["low", "medium"].includes(loaded.imageQuality)) loaded.imageQuality = DEFAULT_SETTINGS.imageQuality;
    if (typeof loaded.imageSameAsText !== "boolean") loaded.imageSameAsText = false;
    if (typeof loaded.imageBaseUrl !== "string" || !loaded.imageBaseUrl.trim()) loaded.imageBaseUrl = DEFAULT_SETTINGS.imageBaseUrl;
    if (typeof loaded.imageModel !== "string") loaded.imageModel = DEFAULT_SETTINGS.imageModel;
    return loaded;
  } catch {
    return fresh;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJson(FILE, settings);
}

/** Applies the appearance settings to the page. */
export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty("--reading-size", `${settings.fontSize}px`);
}
