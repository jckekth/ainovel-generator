/**
 * UI languages (spec 11, decision 83).
 *
 * `t()` reads the UI language set with setLocale, so pages and src/lib errors
 * share one switch; App re-renders everything when it changes. English is the
 * source: its keys type the Chinese files, so a missing key fails the build.
 *
 * Story type texts (labels, hints, options, section names) are written in
 * English in the JSON configs and translated here by field key. Choice values
 * are saved in English and shown, or sent to the AI, through optionLabel
 * (decision 84).
 */
import type { FieldDef } from "../lib/fields";
import en from "./en";
import zhHans, { config as zhHansConfig } from "./zh-Hans";
import zhHant, { config as zhHantConfig } from "./zh-Hant";

export type Locale = "en" | "zh-Hans" | "zh-Hant";
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
export type Params = Record<string, string | number>;

export const LOCALES: Locale[] = ["en", "zh-Hans", "zh-Hant"];

/** Each UI language named in its own script, for the picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

const MESSAGES: Record<Locale, Messages> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant };
const CONFIG: Record<Locale, Record<string, string>> = { en: {}, "zh-Hans": zhHansConfig, "zh-Hant": zhHantConfig };

/**
 * Also kept on globalThis: a hot reload in npm run dev runs this module again,
 * and without it the page fell back to English until reloaded (CR6-07).
 */
const kept = globalThis as { __uiLocale?: Locale };
let current: Locale = kept.__uiLocale ?? "en";

export function setLocale(locale: Locale): void {
  current = LOCALES.includes(locale) ? locale : "en";
  kept.__uiLocale = current;
  if (typeof document !== "undefined") document.documentElement.lang = current;
}

export function getLocale(): Locale {
  return current;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as string[]).includes(value);
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    return typeof v === "number" ? v.toLocaleString("en-US") : v;
  });
}

/** A UI text in the current language, with {name} placeholders filled in. */
export function t(key: MessageKey, params?: Params): string {
  return tIn(current, key, params);
}

/** A UI text in a given language. Falls back to English. */
export function tIn(locale: Locale, key: MessageKey, params?: Params): string {
  return fill(MESSAGES[locale]?.[key] ?? en[key] ?? key, params);
}

/** A text with a version per story type, `<key>.<type>`, e.g. a placeholder that fits the genre; else the key itself. */
export function tType(key: MessageKey, typeId: string, params?: Params): string {
  const own = `${key}.${typeId}` as MessageKey;
  return t(own in en ? own : key, params);
}

/** For texts with a singular: uses `<key>.one` when count is 1 and the language has it. */
export function tCount(key: MessageKey, count: number, params?: Params): string {
  const one = `${key}.one` as MessageKey;
  const useOne = count === 1 && (MESSAGES[current]?.[one] ?? en[one]) !== undefined;
  return t(useOne ? one : key, { count, ...params });
}

/**
 * The UI language to start with on first launch (spec 11): Traditional Chinese
 * for Taiwan, Hong Kong and Macau or the Hant script, other Chinese is
 * Simplified, anything else English.
 */
export function detectLocale(languages: readonly string[] = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []): Locale {
  for (const raw of languages) {
    const tag = (raw ?? "").toLowerCase();
    if (!tag.startsWith("zh")) continue;
    if (/hant|-tw|-hk|-mo/.test(tag)) return "zh-Hant";
    return "zh-Hans";
  }
  return "en";
}

// ---------- the novel's language ----------

/**
 * The translation language for a novel language, or null for one outside the
 * three (Japanese, Korean, Malay from before phase 6), which gets English
 * examples and choice values (spec 6.5).
 */
export function novelLocale(language: string): Locale | null {
  const l = language.trim();
  if (!l || /^english$/i.test(l)) return "en";
  if (/简体|simplified/i.test(l)) return "zh-Hans";
  if (/繁體|traditional/i.test(l)) return "zh-Hant";
  return null;
}

// ---------- story type texts ----------

function configText(locale: Locale, key: string, english: string): string {
  return locale === "en" ? english : (CONFIG[locale][key] ?? english);
}

export function hasConfigText(locale: Locale, key: string): boolean {
  return key in CONFIG[locale];
}

export function fieldLabel(field: FieldDef, locale: Locale = current): string {
  return configText(locale, `field.${field.key}.label`, field.label);
}

export function fieldHint(field: FieldDef, locale: Locale = current): string | undefined {
  return field.hint === undefined ? undefined : configText(locale, `field.${field.key}.hint`, field.hint);
}

export function fieldPlaceholder(field: FieldDef, locale: Locale = current): string | undefined {
  return field.placeholder === undefined ? undefined : configText(locale, `field.${field.key}.placeholder`, field.placeholder);
}

export function scaleLabels(field: FieldDef, locale: Locale = current): { min?: string; max?: string } {
  return {
    min: field.minLabel === undefined ? undefined : configText(locale, `field.${field.key}.minLabel`, field.minLabel),
    max: field.maxLabel === undefined ? undefined : configText(locale, `field.${field.key}.maxLabel`, field.maxLabel),
  };
}

export function sectionName(section: string, locale: Locale = current): string {
  return configText(locale, `section.${section}`, section);
}

/** A saved (English) choice value in a language; a value with no translation stays as it is. */
export function optionLabel(field: FieldDef, value: string, locale: Locale = current): string {
  return configText(locale, `option.${field.key}.${value}`, value);
}

/**
 * The saved English value for a choice written in any of the three languages,
 * e.g. an End Chapter proposal (decision 84). Unknown text comes back as it is.
 */
export function optionValue(field: FieldDef, text: string): string {
  const wanted = text.trim();
  for (const option of field.options ?? []) {
    if (option.toLowerCase() === wanted.toLowerCase()) return option;
    if (LOCALES.some((l) => l !== "en" && optionLabel(field, option, l) === wanted)) return option;
  }
  return wanted;
}

export function typeName(type: { id: string; name: string }, locale: Locale = current): string {
  return configText(locale, `type.${type.id}.name`, type.name);
}

export function typeDescription(type: { id: string; description: string }, locale: Locale = current): string {
  return configText(locale, `type.${type.id}.description`, type.description);
}
