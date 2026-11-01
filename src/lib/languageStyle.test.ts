import { describe, expect, it } from "vitest";
import { languageStyle } from "./languageStyle";
import { LANGUAGES } from "./storyTypes";

describe("languageStyle (spec 6.5, decision 70)", () => {
  it("adds nothing for English", () => {
    expect(languageStyle("English", "Lin Feng", true)).toEqual([]);
    expect(languageStyle("", "Lin Feng", true)).toEqual([]);
  });

  it("asks for native prose in any other language, also one typed in by the user", () => {
    for (const language of [...LANGUAGES.filter((l) => l !== "English"), "Tiếng Việt"]) {
      expect(languageStyle(language, "Lin Feng", true)[0]).toBe(
        `Write as a native ${language} novelist, not as a translation from English: the natural word order, rhythm, idioms and dialogue of ${language}, with humour and images that work in ${language}.`,
      );
    }
    expect(languageStyle("Bahasa Melayu", "Lin Feng", true)).toHaveLength(1);
  });

  it("gives Traditional Chinese its own notes in Traditional Chinese, with 「」 for dialogue", () => {
    const notes = languageStyle("繁體中文 (Traditional Chinese)", "陳美", true);
    expect(notes).toHaveLength(6);
    expect(notes[2]).toContain("翻譯腔");
    expect(notes).toContain("對話用「」。");
    expect(notes[5]).toContain("例如「陳美去問個清楚」；不要用「請」或「讓」開頭。");
  });

  it("gives Simplified Chinese its own notes in Simplified Chinese, with “” for dialogue", () => {
    const notes = languageStyle("简体中文 (Simplified Chinese)", "林枫", true);
    expect(notes).toHaveLength(6);
    expect(notes[2]).toContain("翻译腔");
    expect(notes).toContain("对话用“”。");
    expect(notes[5]).toContain("例如“林枫去问个清楚”；不要用“请”或“让”开头。");
    // No Traditional characters slipped into the Simplified notes.
    expect(notes.slice(1).join("")).not.toMatch(/[寫為說譯語對話開請讓當單體]/);
  });

  it("leaves out the suggested action note when the answer has none (the epilogue)", () => {
    const notes = languageStyle("繁體中文 (Traditional Chinese)", "陳美", false);
    expect(notes).toHaveLength(5);
    expect(notes.join("")).not.toContain("建議行動");
  });
});
