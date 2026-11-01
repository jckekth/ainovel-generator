import { describe, expect, it } from "vitest";
import {
  chapterLimits,
  chapterProgress,
  chapterStage,
  countsCharacters,
  countWords,
  estimateTokens,
  finaleReached,
  plannedChapters,
  storyArcStage,
  storyLengthRule,
  tailText,
  tokensToLength,
} from "./length";

describe("counting (spec 5.3, decisions 24, 48)", () => {
  it("counts Chinese and Japanese in characters, other languages in words", () => {
    expect(countsCharacters("简体中文 (Simplified Chinese)")).toBe(true);
    expect(countsCharacters("繁體中文 (Traditional Chinese)")).toBe(true);
    expect(countsCharacters("日本語 (Japanese)")).toBe(true);
    expect(countsCharacters("한국어 (Korean)")).toBe(false);
    expect(countsCharacters("English")).toBe(false);
    expect(countsCharacters("Bahasa Melayu")).toBe(false);
  });

  it("counts words by spaces, ignoring extra whitespace", () => {
    expect(countWords("  The bell\nrang  three times. ", "English")).toBe(5);
    expect(countWords("", "English")).toBe(0);
    expect(countWords("지민이가 웃었다", "한국어 (Korean)")).toBe(2);
  });

  it("counts characters without spaces for Chinese", () => {
    expect(countWords("林风 抬起头。\n他笑了", "简体中文 (Simplified Chinese)")).toBe(9);
  });
});

describe("chapter limits (spec 5.3)", () => {
  it.each([
    ["Short", "English", 1500, 2250, "words"],
    ["Medium", "English", 2500, 3750, "words"],
    ["Long", "English", 4000, 6000, "words"],
    ["Short", "简体中文 (Simplified Chinese)", 2500, 3750, "characters"],
    ["Medium", "日本語 (Japanese)", 4000, 6000, "characters"],
    ["Long", "简体中文 (Simplified Chinese)", 6500, 9750, "characters"],
  ])("%s in %s: target %i, hard limit %i %s", (length, language, target, hard, unit) => {
    expect(chapterLimits(length, language)).toEqual({ target, hard, unit });
  });

  it("falls back to Medium for an unknown chapter length", () => {
    expect(chapterLimits("?", "English").target).toBe(2500);
  });

  it("is open below the target, soft from the target and hard from 150%", () => {
    const limits = chapterLimits("Short", "English");
    expect(chapterStage(1499, limits)).toBe("open");
    expect(chapterStage(1500, limits)).toBe("soft");
    expect(chapterStage(2249, limits)).toBe("soft");
    expect(chapterStage(2250, limits)).toBe("hard");
  });

  it("measures the blocks so far", () => {
    const blocks = [Array(800).fill("w").join(" "), Array(800).fill("w").join(" ")];
    expect(chapterProgress(blocks, "Short", "English")).toMatchObject({ count: 1600, stage: "soft" });
    expect(chapterProgress([], "Short", "English")).toMatchObject({ count: 0, stage: "open" });
  });
});

describe("tails and token estimates (spec 6.2, decision 53)", () => {
  it("keeps the last words of a text", () => {
    expect(tailText("  one two\nthree four ", 2, "English")).toBe("three four");
    expect(tailText("one", 5, "English")).toBe("one");
    expect(tailText("one two", 0, "English")).toBe("");
  });

  it("keeps 5/3 characters per word in a language without spaces", () => {
    const text = "林".repeat(1000) + "风".repeat(500);
    const tail = tailText(text, 300, "简体中文 (Simplified Chinese)");
    expect(tail).toBe("风".repeat(500));
    expect(tailText("短", 300, "简体中文 (Simplified Chinese)")).toBe("短");
  });

  it("estimates tokens as words × 4/3, or one per character", () => {
    expect(estimateTokens(Array(300).fill("word").join(" "), "English")).toBe(400);
    expect(estimateTokens("林风 笑了", "简体中文 (Simplified Chinese)")).toBe(4);
  });

  it("turns a token cap into words or characters", () => {
    expect(tokensToLength(1000, "English")).toEqual({ amount: 750, unit: "words" });
    expect(tokensToLength(1000, "简体中文 (Simplified Chinese)")).toEqual({ amount: 1000, unit: "characters" });
  });
});

describe("story length (spec 5.7, decision 47)", () => {
  it("plans 8 chapters for a short story, 60 for a long one, none for a continuous one", () => {
    expect(plannedChapters("Short story")).toBe(8);
    expect(plannedChapters("Long story")).toBe(60);
    expect(plannedChapters("Continuous")).toBeNull();
    expect(plannedChapters("?")).toBeNull();
  });

  it("describes the whole story's pacing", () => {
    expect(storyLengthRule("Short story")).toMatch(/about 8 chapters, told as one arc/);
    expect(storyLengthRule("Long story")).toMatch(/about 60 chapters in 3 volumes of about 20/);
    expect(storyLengthRule("Continuous")).toMatch(/no planned end.*never resolve the main conflict/);
  });

  it("paces a short story: set-up, rising conflict, finale in the last two chapters, wrap-up after", () => {
    expect(storyArcStage("Short story", 1)).toMatch(/the set-up/);
    expect(storyArcStage("Short story", 4)).toMatch(/the rising conflict/);
    expect(storyArcStage("Short story", 6)).toMatch(/the rising conflict/);
    expect(storyArcStage("Short story", 7)).toMatch(/one of the last two: steer toward the finale/);
    expect(storyArcStage("Short story", 8)).toMatch(/steer toward the finale and resolve the central conflict by chapter 8/);
    expect(storyArcStage("Short story", 9)).toMatch(/past the planned 8 chapters: wrap up/);
  });

  it("paces a long story by volume", () => {
    expect(storyArcStage("Long story", 1)).toMatch(/the opening of volume 1/);
    expect(storyArcStage("Long story", 10)).toMatch(/chapter 10 of volume 1: develop/);
    expect(storyArcStage("Long story", 20)).toMatch(/the end of volume 1: bring this volume's arc to its climax/);
    expect(storyArcStage("Long story", 21)).toMatch(/the opening of volume 2/);
    expect(storyArcStage("Long story", 59)).toMatch(/steer toward the finale/);
    expect(storyArcStage("Long story", 61)).toMatch(/past the planned 60/);
  });

  it("never steers a continuous story to an end", () => {
    expect(storyArcStage("Continuous", 50)).toMatch(/continuous story: keep the current arc moving/);
    expect(storyArcStage("Continuous", 50)).not.toMatch(/finale/);
  });

  it("highlights End story once the planned chapters are written", () => {
    expect(finaleReached("Short story", 7)).toBe(false);
    expect(finaleReached("Short story", 8)).toBe(true);
    expect(finaleReached("Long story", 60)).toBe(true);
    expect(finaleReached("Continuous", 500)).toBe(false);
  });
});
