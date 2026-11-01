import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectLocale,
  fieldLabel,
  getLocale,
  hasConfigText,
  LOCALES,
  MessageKey,
  novelLocale,
  optionLabel,
  optionValue,
  sectionName,
  setLocale,
  t,
  tCount,
  tIn,
  tType,
  typeName,
} from ".";
import en from "./en";
import zhHans from "./zh-Hans";
import zhHant from "./zh-Hant";
import { characterFields, settingFields, STORY_TYPES } from "../lib/storyTypes";

afterEach(() => setLocale("en"));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const CJK = /[\p{Script=Han}]/u;

describe("t (spec 11, decision 83)", () => {
  it("fills placeholders, with numbers grouped", () => {
    expect(t("novel.pendingTitle", { n: 3 })).toBe("Chapter 3 is saved");
    expect(t("tokens.amount", { input: 12345, output: 300 })).toBe("12,345 in · 300 out tokens");
  });

  it("reads the language set with setLocale, and tIn reads any", () => {
    setLocale("zh-Hant");
    expect(getLocale()).toBe("zh-Hant");
    expect(t("nav.settings")).toBe("設定");
    expect(tIn("zh-Hans", "nav.settings")).toBe("设置");
    expect(tIn("en", "nav.settings")).toBe("Settings");
  });

  it("falls back to English for an unknown language", () => {
    setLocale("fr" as never);
    expect(getLocale()).toBe("en");
  });

  it("uses the singular for one where the language has it", () => {
    expect(tCount("common.chapters", 1)).toBe("1 chapter");
    expect(tCount("common.chapters", 4)).toBe("4 chapters");
    setLocale("zh-Hans");
    expect(tCount("common.chapters", 4)).toBe("4 章");
  });
});

describe("tType (QA-09)", () => {
  it("uses the story type's own text, else the shared one", () => {
    expect(tType("direction.placeholder", "fantasy")).toMatch(/wolf tracks/);
    expect(tType("direction.placeholder", "cultivation")).toMatch(/sect/);
    expect(tType("notes.placeholder", "horror")).toBe(t("notes.placeholder"));
    setLocale("zh-Hant");
    expect(tType("notes.placeholder", "romance")).toMatch(/傘/);
  });
});

describe("translation files", () => {
  const files = { "zh-Hans": zhHans, "zh-Hant": zhHant };

  it.each(Object.entries(files))("%s has every key with the same placeholders as English", (_locale, messages) => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(messages[key], key).toBeTypeOf("string");
      expect(placeholders(messages[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it.each(Object.entries(files))("%s is written in Chinese, not left in English", (_locale, messages) => {
    // Texts that are only placeholders and symbols need no words.
    const symbolsOnly = (s: string) => !/[A-Za-z\p{Script=Han}]/u.test(s.replace(/\{\w+\}/g, ""));
    for (const [key, text] of Object.entries(messages)) {
      if (symbolsOnly(text)) continue;
      expect(CJK.test(text), `${key}: ${text}`).toBe(true);
    }
  });

  it("keeps Traditional characters out of the Simplified file", () => {
    const traditional = /[這個們與為說會對設檔體點開關讀寫儲書詞記]/;
    for (const [key, text] of Object.entries(zhHans)) expect(traditional.test(text), `${key}: ${text}`).toBe(false);
  });
});

describe("story type texts (spec 4, 11)", () => {
  for (const type of STORY_TYPES) {
    const fields = [...settingFields(type), ...characterFields(type)];

    it.each(["zh-Hans", "zh-Hant"] as const)(`${type.id}: every label, hint, option and section has a %s translation`, (locale) => {
      const missing: string[] = [];
      const need = (key: string) => !hasConfigText(locale, key) && missing.push(key);
      need(`type.${type.id}.name`);
      need(`type.${type.id}.description`);
      for (const f of fields) {
        need(`field.${f.key}.label`);
        for (const k of ["hint", "placeholder", "minLabel", "maxLabel"] as const) if (f[k] !== undefined) need(`field.${f.key}.${k}`);
        for (const o of f.options ?? []) need(`option.${f.key}.${o}`);
        need(`section.${f.section}`);
      }
      expect(missing).toEqual([]);
    });

    it(`${type.id}: options read back to the saved English value from every language (decision 84)`, () => {
      for (const f of fields) {
        for (const locale of LOCALES) {
          const labels = (f.options ?? []).map((o) => optionLabel(f, o, locale));
          expect(new Set(labels).size, `${f.key} in ${locale}`).toBe(labels.length);
          for (const o of f.options ?? []) expect(optionValue(f, optionLabel(f, o, locale)), `${f.key} ${o} ${locale}`).toBe(o);
        }
      }
    });
  }

  it("shows labels, sections and names in the UI language, English from the config", () => {
    const tone = settingFields(STORY_TYPES[0]).find((f) => f.key === "tone")!;
    expect(fieldLabel(tone)).toBe("Tone");
    expect(optionLabel(tone, "Happy")).toBe("Happy");
    setLocale("zh-Hant");
    expect(fieldLabel(tone)).toBe("基調");
    expect(optionLabel(tone, "Happy")).toBe("輕鬆");
    expect(sectionName("Story")).toBe("故事");
    expect(typeName(STORY_TYPES[1])).toBe("言情");
    // A value with no translation is shown as saved.
    expect(optionLabel(tone, "Melancholy")).toBe("Melancholy");
  });

  it("reads an unknown value back unchanged", () => {
    const tone = settingFields(STORY_TYPES[0]).find((f) => f.key === "tone")!;
    expect(optionValue(tone, "  happy ")).toBe("Happy");
    expect(optionValue(tone, "Melancholy")).toBe("Melancholy");
  });
});

describe("languages", () => {
  it.each([
    [["zh-TW"], "zh-Hant"],
    [["zh-HK"], "zh-Hant"],
    [["zh-Hant-MO"], "zh-Hant"],
    [["zh-CN"], "zh-Hans"],
    [["zh"], "zh-Hans"],
    [["en-GB", "zh-TW"], "zh-Hant"],
    [["fr-FR"], "en"],
    [[], "en"],
  ])("starts the UI in the system language: %j gives %s (spec 11)", (languages, locale) => {
    expect(detectLocale(languages as string[])).toBe(locale);
  });

  it("maps a novel language to its translations, and others to none (spec 6.5)", () => {
    expect(novelLocale("English")).toBe("en");
    expect(novelLocale("简体中文 (Simplified Chinese)")).toBe("zh-Hans");
    expect(novelLocale("繁體中文 (Traditional Chinese)")).toBe("zh-Hant");
    expect(novelLocale("日本語 (Japanese)")).toBeNull();
    expect(novelLocale("Bahasa Melayu")).toBeNull();
  });
});

describe("hot reload in npm run dev (CR6-07)", () => {
  it("keeps the chosen language when the module runs again", async () => {
    setLocale("zh-Hant");
    vi.resetModules();
    const again = await import(".");
    expect(again.getLocale()).toBe("zh-Hant");
  });
});
