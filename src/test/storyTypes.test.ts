/**
 * Config contract tests: every story type file is well formed and keeps the
 * rules the spec gives it. A new story type is checked as soon as it is added
 * to STORY_TYPES; add its own spec rules at the bottom.
 */
import { describe, expect, it } from "vitest";
import { backgroundUrl, figureKind, figureUrl } from "../lib/art";
import { hiddenKeys, newCharacter, requiredKeys } from "../lib/characters";
import { setMainCharacter, setsOf, setValues } from "../lib/curatedSets";
import { defaultValue, defaultValues, FieldDef, FieldType, normalize, pickOptions, Rank, rankOptions, validate } from "../lib/fields";
import {
  characterFields,
  getStoryType,
  LANGUAGES,
  settingFields,
  STORY_TYPES,
  storyTypeName,
} from "../lib/storyTypes";

const FIELD_TYPES: FieldType[] = ["text", "longtext", "number", "choice", "multi", "list", "scale", "rank", "ladder", "language", "pick"];

function checkFields(fields: FieldDef[]) {
  const keys = fields.map((f) => f.key);
  expect(new Set(keys).size, `duplicate keys in ${keys.join(", ")}`).toBe(keys.length);

  for (const f of fields) {
    const where = `field "${f.key}"`;
    expect(f.key, where).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(f.label, where).toBeTruthy();
    expect(f.section, where).toBeTruthy();
    expect(FIELD_TYPES, where).toContain(f.type);

    if (f.type === "choice" || f.type === "multi") {
      expect(f.options?.length, `${where} has no options`).toBeGreaterThan(0);
    }
    if (f.type === "choice" && f.default !== undefined) {
      expect(f.options, `${where} default is not an option`).toContain(f.default);
    }
    if (f.type === "multi" && f.default !== undefined) {
      for (const v of f.default as string[]) expect(f.options, `${where} default is not an option`).toContain(v);
      expect((f.default as string[]).length, `${where} default picks too many`).toBeLessThanOrEqual(f.max ?? Infinity);
    }
    if (f.type === "scale") {
      const v = defaultValue(f) as number;
      expect(v, `${where} default out of range`).toBeGreaterThanOrEqual(f.min ?? 1);
      expect(v, `${where} default out of range`).toBeLessThanOrEqual(f.max ?? 5);
    }
    if (f.required) expect(f.hideForMain, `${where} is required but hidden for the main character`).toBeFalsy();
    if (f.otherOption) expect(f.options, `${where} other option is not an option`).toContain(f.otherOption);
  }
}

describe.each(STORY_TYPES.map((t) => [t.id, t] as const))("story type %s", (_, type) => {
  it("has a name, a description and writing instructions", () => {
    expect(type.name).toBeTruthy();
    expect(type.description).toBeTruthy();
    expect(type.prompt.length).toBeGreaterThan(0);
    for (const line of type.prompt) expect(typeof line).toBe("string");
  });

  it("has well-formed setting fields", () => checkFields(settingFields(type)));

  it("has well-formed character fields", () => checkFields(characterFields(type)));

  it("picks character fields only from list fields of its own setting", () => {
    const setting = settingFields(type);
    for (const f of characterFields(type).filter((x) => x.type === "pick")) {
      expect(setting.find((s) => s.key === f.from)?.type, `field "${f.key}"`).toBe("list");
    }
  });

  it("has its background art (spec 12.3)", () => {
    expect(backgroundUrl(type.id)).toBeTruthy();
  });

  it("only requires main character fields that exist", () => {
    const keys = characterFields(type).map((f) => f.key);
    for (const k of type.rules.mainCharacterRequired ?? []) expect(keys).toContain(k);
  });

  it("has a default age for AI-proposed characters, allowed by the age field and the type's minimum (decision 67)", () => {
    const age = characterFields(type).find((f) => f.key === "age")!;
    expect(Number.isInteger(type.rules.defaultAge)).toBe(true);
    expect(type.rules.defaultAge).toBeGreaterThanOrEqual(Math.max(age.min ?? 0, type.rules.minAge ?? 0));
    expect(type.rules.defaultAge).toBeLessThanOrEqual(age.max ?? Infinity);
  });

  it("has a default for every setting field (decision 44)", () => {
    // The language comes from the story itself, so it needs no default.
    const missing = settingFields(type).filter((f) => f.key !== "language" && f.default === undefined);
    expect(missing.map((f) => f.key)).toEqual([]);
  });

  it("only overrides setting defaults of fields that exist", () => {
    const keys = settingFields(type).map((f) => f.key);
    for (const k of Object.keys(type.settingDefaults ?? {})) expect(keys).toContain(k);
  });

  it("puts the common fields first and the status last", () => {
    // General puts its world boxes first (decision 129); the Story fields still come as one block.
    const setting = settingFields(type).map((f) => f.key);
    expect(setting.indexOf("language")).toBe(type.worldFirst ? type.settingFields.length : 0);
    expect(characterFields(type)[0].key).toBe("name");
    expect(characterFields(type).map((f) => f.key).slice(-3)).toEqual(["status", "location", "condition"]);
  });
});

describe("rules from the spec", () => {
  it("has the two version 1 story types, fantasy from v0.3 and general from phase 7b (spec 1, decisions 101, 125)", () => {
    expect(STORY_TYPES.map((t) => t.id).sort()).toEqual(["cultivation", "fantasy", "general", "romance"]);
  });

  it("gives general five world boxes and one character box, and an SVG background (spec 7.7, 8.6, decisions 127, 128)", () => {
    const type = getStoryType("general");
    expect(type.settingFields.map((f) => f.key)).toEqual(["genre_style", "important_places", "groups_factions", "world_rules"]);
    for (const f of type.settingFields) {
      expect(f.default, f.key).toBe("");
      expect(f.placeholder, f.key).toBeTruthy();
    }
    expect(type.characterFields.map((f) => f.key)).toEqual(["abilities_notes"]);
    expect(backgroundUrl("general")).toMatch(/general.*\.svg/);
  });

  it("requires a class for the fantasy main character, with Other typed in (spec 7.6, decision 105)", () => {
    const type = getStoryType("fantasy");
    expect(type.rules.mainCharacterRequired).toEqual(["class"]);
    expect(type.rules.defaultAge).toBe(20);
    expect(type.rules.minAge).toBeUndefined();
    const cls = characterFields(type).find((f) => f.key === "class")!;
    expect(cls.options).toEqual(["Warrior", "Knight", "Mage", "Healer", "Rogue", "Ranger", "Bard", "Other"]);
    expect(cls.otherOption).toBe("Other");
  });

  it("chooses fantasy race and adventurer rank from the setting's lists (spec 7.6, 8.5, decision 104)", () => {
    const fields = characterFields(getStoryType("fantasy"));
    expect(fields.find((f) => f.key === "race")).toMatchObject({ type: "pick", from: "races" });
    expect(fields.find((f) => f.key === "adventurer_rank")).toMatchObject({ type: "pick", from: "adventurer_ranks", hideWhenEmpty: true });
    expect(fields.find((f) => f.key === "adventurer_rank")?.required).toBeFalsy();
  });

  it("gives fantasy four curated sets, each main character of a different class (decision 106)", () => {
    const sets = setsOf("fantasy");
    expect(sets.map((s) => s.id)).toEqual(["fading-crown", "ash-and-iron", "spire-academy", "wildmarch"]);
    expect(sets.map((s) => s.main.class)).toEqual(["Knight", "Rogue", "Mage", "Ranger"]);
  });

  it("forbids cultivation words in fantasy prompts (decision 106)", () => {
    expect(getStoryType("fantasy").prompt.join(" ")).toMatch(/never use cultivation words/i);
  });

  it("defaults main character death to 'only when I direct it' (decision 20)", () => {
    const field = settingFields(getStoryType("romance")).find((f) => f.key === "main_character_death");
    expect(field?.default).toBe("Only when I direct it");
    expect(field?.options).toEqual(["Never", "Only when I direct it", "The AI may decide"]);
  });

  it("offers General and Mature content ratings only (decision 15)", () => {
    const field = settingFields(getStoryType("romance")).find((f) => f.key === "content_rating");
    expect(field?.options).toEqual(["General", "Mature"]);
  });

  it("gives each genre its own default tone (decision 44)", () => {
    const tone = (id: string) => settingFields(getStoryType(id)).find((f) => f.key === "tone")?.default;
    expect(tone("cultivation")).toEqual(["Hot-blooded"]);
    expect(tone("romance")).toEqual(["Happy", "Humorous"]);
  });

  it("offers a story length, Continuous by default (spec 5.7, decision 47)", () => {
    const field = settingFields(getStoryType("cultivation")).find((f) => f.key === "story_length");
    expect(field?.options).toEqual(["Short story", "Long story", "Continuous"]);
    expect(field?.default).toBe("Continuous");
  });

  it("allows at most two tones (spec 8.2)", () => {
    expect(settingFields(getStoryType("romance")).find((f) => f.key === "tone")?.max).toBe(2);
  });

  it("requires romance characters to be 18 or older (decision 16)", () => {
    expect(getStoryType("romance").rules.minAge).toBe(18);
  });

  it("requires a special ability for the cultivation main character (spec 7.3)", () => {
    expect(getStoryType("cultivation").rules.mainCharacterRequired).toContain("special_ability");
  });

  it("pre-fills a cultivation rank ladder with stages (spec 8.3)", () => {
    const ladder = settingFields(getStoryType("cultivation")).find((f) => f.key === "rank_ladder");
    const ranks = ladder?.default as { name: string; stages: string[] }[];
    expect(ranks.length).toBeGreaterThan(1);
    expect(ranks.some((r) => r.stages.length > 0)).toBe(true);
  });

  it("gives the cultivation rank a rank field and romance an affection scale of 0-100 (spec 7.3, 7.4)", () => {
    expect(characterFields(getStoryType("cultivation")).find((f) => f.key === "cultivation_rank")?.type).toBe("rank");
    const affection = characterFields(getStoryType("romance")).find((f) => f.key === "affection");
    expect([affection?.min, affection?.max, affection?.hideForMain]).toEqual([0, 100, true]);
  });
});

describe("lookups", () => {
  it("explains an unknown story type", () => {
    expect(() => getStoryType("horror")).toThrow("unknown story type (“horror”)");
    expect(storyTypeName("horror")).toBe("horror");
    expect(storyTypeName("romance")).toBe("Romance");
  });

  it("offers English, Simplified and Traditional Chinese for new novels (decision 71)", () => {
    expect(LANGUAGES).toEqual(["English", "简体中文 (Simplified Chinese)", "繁體中文 (Traditional Chinese)"]);
  });
});

// Decisions 72, 85: every type has curated sets, complete in all three novel languages.
const NOVEL_LANGUAGES = { en: "English", "zh-Hans": "简体中文 (Simplified Chinese)", "zh-Hant": "繁體中文 (Traditional Chinese)" } as const;

/** Every type has curated sets but General, whose world the user writes (decision 128). */
const WITH_SETS = STORY_TYPES.filter((t) => t.id !== "general");

describe.each(WITH_SETS.map((t) => [t.id, t] as const))("curated sets of %s", (_id, type) => {
  const sets = setsOf(type.id);
  const settingKeys = settingFields(type).map((f) => f.key);
  const fields = characterFields(type);
  const hidden = hiddenKeys(fields, true);

  it("has several sets with unique ids", () => {
    expect(sets.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sets.map((s) => s.id)).size).toBe(sets.length);
  });

  it.each(sets.map((s) => [s.id, s] as const))("set %s covers the same fields in every language", (_sid, set) => {
    const en = set.text.en;
    for (const locale of ["zh-Hans", "zh-Hant"] as const) {
      const text = set.text[locale];
      expect(Object.keys(text.values).sort(), locale).toEqual(Object.keys(en.values).sort());
      expect(Object.keys(text.main).sort(), locale).toEqual(Object.keys(en.main).sort());
      expect(text.background.trim(), locale).not.toBe("");
      expect(text.mainBackground.trim(), locale).not.toBe("");
      expect(text.names.male.length, locale).toBe(en.names.male.length);
      expect(text.names.female.length, locale).toBe(en.names.female.length);
    }
    expect(en.background.trim().length).toBeGreaterThan(100);
    expect(en.names.male.length).toBeGreaterThanOrEqual(5);
    expect(en.names.female.length).toBeGreaterThanOrEqual(5);
  });

  it.each(sets.map((s) => [s.id, s] as const))("set %s gives a valid setting and main character in each language", (_sid, set) => {
    for (const language of Object.values(NOVEL_LANGUAGES)) {
      const values = setValues(set, language);
      for (const k of Object.keys(values)) expect(settingKeys, `${language}: unknown setting key ${k}`).toContain(k);
      const setting = normalize(settingFields(type), { ...defaultValues(settingFields(type)), ...values, language });
      const required = new Set(settingFields(type).filter((f) => f.required).map((f) => f.key));
      const ranks = rankOptions((setting.rank_ladder ?? []) as Rank[]);
      expect(validate(settingFields(type), setting, { required, hidden: new Set(), rankOptions: ranks }), language).toEqual({});

      const main = setMainCharacter(set, language);
      for (const k of Object.keys(main.values)) {
        expect(fields.map((f) => f.key), `${language}: unknown character key ${k}`).toContain(k);
        expect(hidden.has(k), `${language}: ${k} is hidden for the main character`).toBe(false);
      }
      // Ranks are checked against the set's own ladder in the same language.
      const character = normalize(fields, newCharacter(type, true, main).values);
      const errors = validate(fields, character, { required: requiredKeys(type, fields, true), hidden, rankOptions: ranks, minAge: type.rules.minAge });
      expect(errors, language).toEqual({});
    }
  });

  it.each(sets.map((s) => [s.id, s] as const))("set %s never repeats a name or uses the main character's in its pool", (_sid, set) => {
    for (const locale of ["en", "zh-Hans", "zh-Hant"] as const) {
      const { male, female } = set.text[locale].names;
      const all = [...male, ...female];
      expect(new Set(all).size, locale).toBe(all.length);
      expect(all, locale).not.toContain(set.text[locale].main.name);
    }
  });
});

// Spec 12.3: every story type has a background (checked per type above) and the three shared figures exist.
describe("story art", () => {
  it("has the male, female and neutral figures", () => {
    // Found by the same lookup the app uses, so a missing or misnamed file fails here.
    for (const g of ["Male", "Female", ""]) expect(figureUrl(g), g).toMatch(/figure-(male|female|neutral).png/);
  });

  it("shows the neutral figure for Non-binary, Other and no gender (decision 99)", () => {
    expect(["Male", "Female", "Non-binary", "Other", "", undefined].map(figureKind)).toEqual(["male", "female", "neutral", "neutral", "neutral", "neutral"]);
  });
});

describe.each(WITH_SETS.map((t) => [t.id, t] as const))("curated set lists of %s", (_id, type) => {
  const picks = characterFields(type).filter((f) => f.type === "pick");
  it.each(setsOf(type.id).map((s) => [s.id, s] as const))("set %s gives a main character whose picks are in its own lists", (_sid, set) => {
    for (const language of Object.values(NOVEL_LANGUAGES)) {
      const values = setValues(set, language);
      const main = setMainCharacter(set, language);
      for (const f of picks) {
        const v = main.values[f.key];
        if (v) expect(pickOptions(values[f.from!]), `${language}: ${f.key}`).toContain(v);
      }
    }
  });
});
