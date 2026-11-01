import { describe, expect, it } from "vitest";
import {
  choiceToEnglish,
  coerce,
  defaultValue,
  defaultValues,
  FieldDef,
  headerFromValues,
  localizeChoices,
  normalize,
  pickOptions,
  pickOptionsFor,
  rankOptions,
  validate,
  ValidationContext,
  valuesFromHeader,
} from "./fields";

const f = (key: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label: key[0].toUpperCase() + key.slice(1),
  type,
  section: "Test",
  ...extra,
});

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  required: new Set(),
  hidden: new Set(),
  rankOptions: [],
  ...over,
});

describe("defaultValue", () => {
  it.each([
    ["text", ""],
    ["longtext", ""],
    ["choice", ""],
    ["number", null],
    ["list", []],
    ["multi", []],
    ["ladder", []],
  ] as const)("gives %s an empty value", (type, expected) => {
    expect(defaultValue(f("x", type))).toEqual(expected);
  });

  it("uses the scale midpoint, or 3 without min and max", () => {
    expect(defaultValue(f("x", "scale", { min: 0, max: 100 }))).toBe(50);
    expect(defaultValue(f("x", "scale"))).toBe(3);
  });

  it("returns a copy of the config default, so editing it does not change the config", () => {
    const field = f("ladder", "ladder", { default: [{ name: "Mortal", stages: [] }] });
    const value = defaultValue(field) as { name: string }[];
    value[0].name = "Changed";
    expect((field.default as { name: string }[])[0].name).toBe("Mortal");
  });

  it("builds a value per field", () => {
    expect(defaultValues([f("a", "text"), f("b", "list")])).toEqual({ a: "", b: [] });
  });
});

describe("coerce (values from hand-edited files)", () => {
  it("falls back to the default for missing values", () => {
    expect(coerce(f("x", "number"), undefined)).toBeNull();
    expect(coerce(f("x", "text", { default: "Hi" }), null)).toBe("Hi");
  });

  it("reads numbers from strings and rejects junk", () => {
    expect(coerce(f("x", "number"), "19")).toBe(19);
    expect(coerce(f("x", "scale", { min: 1, max: 5 }), "abc")).toBe(3);
  });

  it("turns a single string into a one-item list", () => {
    expect(coerce(f("x", "list"), "Sword")).toEqual(["Sword"]);
    expect(coerce(f("x", "list"), "  ")).toEqual([]);
    expect(coerce(f("x", "multi"), ["Sad", null, 3])).toEqual(["Sad", "3"]);
  });

  it("reads a ladder from strings and objects and drops junk", () => {
    expect(coerce(f("x", "ladder"), ["Mortal", { name: "Qi", stages: ["Early"] }, 42, null])).toEqual([
      { name: "Mortal", stages: [] },
      { name: "Qi", stages: ["Early"] },
    ]);
    expect(coerce(f("x", "ladder"), "not a list")).toEqual([]);
  });

  it("joins an array into text", () => {
    expect(coerce(f("x", "text"), ["a", "b"])).toBe("a, b");
    expect(coerce(f("x", "text"), 12)).toBe("12");
  });
});

describe("normalize", () => {
  it("trims text and drops empty list lines and nameless ranks", () => {
    const fields = [f("name", "text"), f("traits", "list"), f("age", "number"), f("ladder", "ladder")];
    const out = normalize(fields, {
      name: "  Lin  ",
      traits: [" brave ", "", "  "],
      age: Number.NaN,
      ladder: [
        { name: " Qi ", stages: [" Early ", ""] },
        { name: "  ", stages: ["x"] },
      ],
      unknown: "kept",
    });
    expect(out).toEqual({
      name: "Lin",
      traits: ["brave"],
      age: null,
      ladder: [{ name: "Qi", stages: ["Early"] }],
      unknown: "kept",
    });
  });

  it("turns a non-string text value into empty text", () => {
    expect(normalize([f("name", "text")], { name: 5 })).toEqual({ name: "" });
  });
});

describe("rankOptions", () => {
  it("lists every rank and stage", () => {
    expect(
      rankOptions([
        { name: "Mortal", stages: [] },
        { name: "Qi Refining", stages: ["Early", "Late"] },
      ]),
    ).toEqual(["Mortal", "Qi Refining, Early", "Qi Refining, Late"]);
  });
});

describe("header conversion", () => {
  const fields = [f("name", "text"), f("relationship", "text"), f("age", "number")];

  it("keeps keys the form does not know as extra", () => {
    const { values, extra } = valuesFromHeader(fields, { name: "Mei", custom: 1 });
    expect(values).toEqual({ name: "Mei", relationship: "", age: null });
    expect(extra).toEqual({ custom: 1 });
  });

  it("writes fields in order, leaves out hidden ones and puts extra keys last", () => {
    const header = headerFromValues(fields, { age: 20, name: "Mei" }, new Set(["relationship"]), { custom: 1 });
    expect(Object.keys(header)).toEqual(["name", "age", "custom"]);
    expect(header).toEqual({ name: "Mei", age: 20, custom: 1 });
  });

  it("writes missing values as null", () => {
    expect(headerFromValues([f("age", "number")], {}, new Set())).toEqual({ age: null });
  });
});

describe("validate", () => {
  it("requires required fields, with a special message for the ladder", () => {
    const errors = validate([f("name", "text"), f("ladder", "ladder")], { name: " ", ladder: [] }, ctx({
      required: new Set(["name", "ladder"]),
    }));
    expect(errors).toEqual({ name: "Name is required.", ladder: "Add at least one rank." });
  });

  it("ignores empty optional fields and hidden fields", () => {
    const fields = [f("gender", "choice", { options: ["Male"] }), f("relationship", "text")];
    expect(validate(fields, { gender: "", relationship: "" }, ctx({ hidden: new Set(["relationship"]), required: new Set(["relationship"]) }))).toEqual({});
  });

  it("enforces the story type's minimum age (decision 16)", () => {
    const fields = [f("age", "number", { min: 0 })];
    const c = ctx({ minAge: 18 });
    expect(validate(fields, { age: null }, c).age).toMatch(/Enter an age/);
    expect(validate(fields, { age: 17 }, c).age).toMatch(/18 or older/);
    expect(validate(fields, { age: 18 }, c)).toEqual({});
  });

  it("checks whole numbers and the min and max", () => {
    const fields = [f("n", "number", { min: 1, max: 10 })];
    expect(validate(fields, { n: 1.5 }, ctx()).n).toBe("Enter a whole number.");
    expect(validate(fields, { n: 0 }, ctx()).n).toMatch(/lowest allowed value is 1/);
    expect(validate(fields, { n: 11 }, ctx()).n).toMatch(/highest allowed value is 10/);
  });

  it("limits how many options a multi field can pick", () => {
    const fields = [f("tone", "multi", { max: 2, options: ["a", "b", "c"] })];
    expect(validate(fields, { tone: ["a", "b", "c"] }, ctx()).tone).toBe("Pick at most 2.");
  });

  it("only accepts ranks from the story's ladder (spec 7.3)", () => {
    const fields = [f("rank", "rank")];
    expect(validate(fields, { rank: "Nascent Soul" }, ctx({ rankOptions: ["Mortal"] })).rank).toMatch(/not in the story's rank ladder/);
    expect(validate(fields, { rank: "Mortal" }, ctx({ rankOptions: ["Mortal"] }))).toEqual({});
  });

  it("only accepts listed choices", () => {
    const fields = [f("gender", "choice", { options: ["Male", "Female"] })];
    expect(validate(fields, { gender: "Robot" }, ctx()).gender).toBe("Pick one of the options.");
  });
});

describe("localizeChoices and choiceToEnglish (decision 84)", () => {
  const tone: FieldDef = { key: "tone", label: "Tone", type: "multi", section: "Story", options: ["Sad", "Happy"] };
  const pov: FieldDef = { key: "point_of_view", label: "Point of view", type: "choice", section: "Story", options: ["God view"] };
  const name: FieldDef = { key: "name", label: "Name", type: "text", section: "Basics" };

  it("puts choice and multi values in a language and leaves other fields", () => {
    const values = { tone: ["Happy", "Odd"], point_of_view: "God view", name: "Happy" };
    expect(localizeChoices([tone, pov, name], values, "zh-Hant")).toEqual({ tone: ["輕鬆", "Odd"], point_of_view: "全知視角", name: "Happy" });
    expect(localizeChoices([tone, pov, name], values, "en")).toBe(values);
  });

  it("reads them back to English from any language", () => {
    expect(choiceToEnglish(tone, ["轻松", "Sad", "Odd"])).toEqual(["Happy", "Sad", "Odd"]);
    expect(choiceToEnglish(pov, "全知視角")).toBe("God view");
    expect(choiceToEnglish(name, "全知視角")).toBe("全知視角");
    expect(choiceToEnglish(pov, 3)).toBe(3);
  });
});

describe("pick fields (decisions 101, 104)", () => {
  it("offers the name before the colon of each list line, once each", () => {
    expect(pickOptions(["Elves: forest folk", "Dwarves", " Humans : many ", "", "Elves: again"])).toEqual(["Elves", "Dwarves", "Humans"]);
    expect(pickOptions(["精灵：长寿的森林居民", "矮人"])).toEqual(["精灵", "矮人"]);
    expect(pickOptions(undefined)).toEqual([]);
  });

  it("takes each pick field's options from the setting list it names", () => {
    const fields = [f("race", "pick", { from: "races" }), f("rank", "pick", { from: "ranks" }), f("name", "text")];
    expect(pickOptionsFor(fields, { races: ["Elves: old"], ranks: [] })).toEqual({ race: ["Elves"], rank: [] });
  });

  it("checks a value against its list only when the lists are given, as for AI proposals (CR-01)", () => {
    const race = f("race", "pick", { from: "races" });
    expect(validate([race], { race: "Giants" }, ctx({ pickOptions: { race: ["Elves"] } })).race).toBe("Pick the Race from the list on the Setting page.");
    expect(validate([race], { race: "Elves" }, ctx({ pickOptions: { race: ["Elves"] } }))).toEqual({});
    expect(validate([race], { race: "" }, ctx({ pickOptions: { race: [] } }))).toEqual({});
  });

  it("turns an object where a value belongs into the default, not \"[object Object]\" (CR-03)", () => {
    expect(coerce(f("class", "choice", { options: ["Mage"] }), { name: "Mage" })).toBe("");
    expect(coerce(f("abilities", "list"), { a: 1 })).toEqual([]);
  });

  it("keeps a value no longer in the list, trimmed", () => {
    const race = f("race", "pick", { from: "races" });
    expect(normalize([race], { race: "  Giants " }).race).toBe("Giants");
    expect(validate([race], { race: "Giants" }, ctx())).toEqual({});
  });
});

describe("a choice with Other typed in (decision 105)", () => {
  const cls = f("class", "choice", { options: ["Mage", "Other"], otherOption: "Other" });

  it("accepts an option or a typed class", () => {
    expect(validate([cls], { class: "Mage" }, ctx())).toEqual({});
    expect(validate([cls], { class: "Necromancer" }, ctx())).toEqual({});
  });

  it("asks for the text while only Other is picked", () => {
    expect(validate([cls], { class: "Other" }, ctx()).class).toBe("Class: type it in the box, or pick one from the list.");
  });

  it("still refuses a value outside the options when there is no Other", () => {
    expect(validate([f("x", "choice", { options: ["A"] })], { x: "B" }, ctx()).x).toBe("Pick one of the options.");
  });
});
