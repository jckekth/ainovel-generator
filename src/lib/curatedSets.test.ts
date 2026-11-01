import { describe, expect, it } from "vitest";
import {
  applySet,
  getSet,
  randomName,
  randomSet,
  setBackground,
  setMainCharacter,
  setsOf,
  setValues,
  switchSetLanguage,
  textLocale,
} from "./curatedSets";

const EN = "English";
const HANT = "繁體中文 (Traditional Chinese)";
const HANS = "简体中文 (Simplified Chinese)";

describe("curated sets (spec 8, decisions 72, 85)", () => {
  it("finds a set by id, or the type's first for a story from before sets", () => {
    expect(getSet("romance", "tower-office")?.id).toBe("tower-office");
    expect(getSet("romance")?.id).toBe(setsOf("romance")[0].id);
    expect(getSet("romance", "gone")?.id).toBe(setsOf("romance")[0].id);
    expect(getSet("horror")).toBeUndefined();
  });

  it("never picks the set shown when Randomize can pick another", () => {
    for (let i = 0; i < 20; i++) expect(randomSet("cultivation", "nine-peaks")?.id).not.toBe("nine-peaks");
    const seen = new Set(Array.from({ length: 200 }, () => randomSet("romance")?.id));
    expect(seen.size).toBe(setsOf("romance").length);
  });

  it("gives the set's text in the novel's language, English for any other", () => {
    const set = getSet("cultivation", "nine-peaks")!;
    expect(textLocale("日本語 (Japanese)")).toBe("en");
    expect(setMainCharacter(set, HANT).values.name).toBe("林峰");
    expect(setMainCharacter(set, HANS).values.name).toBe("林峰");
    expect(setMainCharacter(set, EN).values.name).toBe("Lin Feng");
    expect(setMainCharacter(set, "Bahasa Melayu").values.name).toBe("Lin Feng");
    expect(setValues(set, HANT)).toMatchObject({ tone: ["Hot-blooded"], power_growth: "Steady" });
    expect((setValues(set, HANT).rank_ladder as { name: string }[])[1].name).toBe("煉氣");
  });

  it("returns copies, so editing a form never changes the set", () => {
    const set = getSet("cultivation", "nine-peaks")!;
    (setValues(set, EN).sects_and_factions as string[]).push("Stolen sect");
    (setMainCharacter(set, EN).values.techniques as string[]).push("Stolen technique");
    expect(setValues(set, EN).sects_and_factions).not.toContain("Stolen sect");
    expect(setMainCharacter(set, EN).values.techniques).not.toContain("Stolen technique");
  });

  it("Randomize fills only the set's fields and the background", () => {
    const set = getSet("romance", "hillside-campus")!;
    const { values, background } = applySet({ chapter_length: "Long", trope: "Slow burn", language: EN }, set, EN);
    expect(values).toMatchObject({ chapter_length: "Long", language: EN, trope: "Enemies to lovers", era_and_place: "Campus" });
    expect(background).toBe(setBackground(set, EN));
  });

  it("swaps in the new language only where the field still holds the set's text", () => {
    const set = getSet("romance", "harbour-cafe")!;
    const start = applySet({}, set, EN);
    const typed = { ...start.values, era_and_place_details: "My own town" };
    const swapped = switchSetLanguage(typed, start.background, set, EN, HANT);
    expect(swapped.background).toBe(setBackground(set, HANT));
    expect(swapped.values.era_and_place_details).toBe("My own town");
    const kept = switchSetLanguage(start.values, "A world I wrote", set, EN, HANS);
    expect(kept.background).toBe("A world I wrote");
    expect(kept.values.era_and_place_details).toBe("现代一座繁忙的海港城市");
  });

  it("picks a free name that fits the gender (spec 7.1)", () => {
    const set = getSet("romance", "harbour-cafe")!;
    const { male, female } = set.text.en.names;
    for (let i = 0; i < 10; i++) {
      expect(male).toContain(randomName(set, EN, "Male", []));
      expect(female).toContain(randomName(set, EN, "Female", []));
      expect([...male, ...female]).toContain(randomName(set, EN, "Non-binary", []));
    }
    // Taken names (any case) and the current one are skipped; null once all are used.
    expect(randomName(set, EN, "Male", male.slice(1).map((n) => n.toUpperCase()))).toBe(male[0]);
    expect(randomName(set, EN, "Male", male.slice(1), male[0])).toBeNull();
    expect(set.text["zh-Hant"].names.female).toContain(randomName(set, HANT, "Female", []));
  });
});
