import { describe, expect, it } from "vitest";
import type { Character } from "./characters";
import { charactersInScene, mentions } from "./scene";

function character(name: string, isMain = false, status = "Alive"): Character {
  return { id: name, isMain, values: { name, status }, background: "", extra: {} };
}

describe("mentions (decision 40)", () => {
  it("matches a Latin-script name as a whole word", () => {
    expect(mentions("Then Ann smiled.", "Ann")).toBe(true);
    expect(mentions("Ann's sword", "Ann")).toBe(true);
    expect(mentions("Ann", "Ann")).toBe(true);
  });

  it("does not match part of a longer word", () => {
    expect(mentions("The annual fair. Planning ahead.", "Ann")).toBe(false);
    expect(mentions("Annabel waved.", "Ann")).toBe(false);
    expect(mentions("Ann2 waved.", "Ann")).toBe(false);
  });

  it("is case-sensitive, so a name that is also a word does not match the word", () => {
    expect(mentions("I will go.", "Will")).toBe(false);
    expect(mentions("Will went.", "Will")).toBe(true);
  });

  it("matches a full name with spaces, and names with accents or punctuation", () => {
    expect(mentions("Lin Feng drew his sword.", "Lin Feng")).toBe(true);
    expect(mentions("Lin drew his sword.", "Lin Feng")).toBe(false);
    expect(mentions("José arrived.", "José")).toBe(true);
    expect(mentions("Joséa arrived.", "José")).toBe(false);
    expect(mentions("Dr. Mo (retired) nodded.", "Dr. Mo (retired)")).toBe(true);
  });

  it("matches a Chinese name anywhere, since Chinese has no spaces", () => {
    expect(mentions("林风拔出了剑。", "林风")).toBe(true);
    expect(mentions("苏梅笑了", "苏梅")).toBe(true);
    expect(mentions("林雨拔出了剑。", "林风")).toBe(false);
  });

  it("matches a Latin name next to Chinese text", () => {
    expect(mentions("Alex说：走吧。", "Alex")).toBe(true);
  });

  it("matches Japanese and Korean names anywhere", () => {
    expect(mentions("さくらは笑った", "さくら")).toBe(true);
    expect(mentions("지민이가 웃었다", "지민")).toBe(true);
  });

  it("never matches an empty name", () => {
    expect(mentions("anything", "  ")).toBe(false);
  });
});

describe("charactersInScene (spec 6.1)", () => {
  const main = character("Lin Feng", true);
  const mei = character("Su Mei");
  const elder = character("Elder Wu");
  const ghost = character("Ghost", false, "Inactive");
  const dead = character("Old Bo", false, "Dead");
  const all = [mei, elder, main, ghost, dead];

  it("always includes the main character, first", () => {
    expect(charactersInScene(all, ["Nobody else is here."])).toEqual([main]);
  });

  it("adds characters named in any of the texts", () => {
    const names = charactersInScene(all, ["Su Mei waited.", "", "Ask Elder Wu"]).map((c) => c.values.name);
    expect(names).toEqual(["Lin Feng", "Su Mei", "Elder Wu"]);
  });

  it("leaves out inactive characters but keeps dead ones that are named", () => {
    const names = charactersInScene(all, ["Ghost and Old Bo"]).map((c) => c.values.name);
    expect(names).toEqual(["Lin Feng", "Old Bo"]);
  });

  it("works with no main character", () => {
    expect(charactersInScene([mei], ["Su Mei"])).toEqual([mei]);
  });
});
