import { describe, expect, it } from "vitest";
import { Character, newCharacter } from "./characters";
import { BUDGETS, buildPrompt, PromptInput } from "./prompt";
import { getStoryType } from "./storyTypes";
import { createStory } from "./stories";
import { loadSetting } from "./setting";

const cultivation = getStoryType("cultivation");

function character(name: string, isMain = false, background = `${name}'s past.`): Character {
  const c = newCharacter(cultivation, isMain);
  return { ...c, id: name, values: { ...c.values, name }, background };
}

const main = character("Lin Feng", true, "An orphan raised by the Azure Cloud Sect.");
const mei = character("Su Mei");
const elder = character("Elder Wu");

async function input(patch: Partial<PromptInput> = {}): Promise<PromptInput> {
  // A fixed set, so the setting is the same size in every call (decision 85).
  const setting = await loadSetting(await createStory({ title: "T", type: "cultivation", language: "English", setId: "nine-peaks" }));
  setting.background = "Nine peaks float above a sea of clouds.";
  return {
    storyType: cultivation,
    setting,
    notes: ["Lin Feng owes the sect a life debt."],
    characters: [main, mei, elder],
    budget: "balanced",
    chapter: 1,
    blocks: [],
    direction: "He meets Su Mei at the gate.",
    ...patch,
  };
}

const system = (p: ReturnType<typeof buildPrompt>) => p.messages[0].content;
const user = (p: ReturnType<typeof buildPrompt>) => p.messages[1].content;

describe("buildPrompt layer order (spec 6.1, decision 41)", () => {
  it("sends one system message and one user message", async () => {
    const p = buildPrompt(await input());
    expect(p.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("puts the layers in the order of spec 6.1", async () => {
    const p = buildPrompt(
      await input({
        blocks: ["Block one."],
        storySummary: "Lin Feng joined the sect.",
        usedScenes: ["Joining a sect"],
        chapterSummaries: ["Chapter one summary."],
        previousChapter: "The last words of chapter one.",
        chapter: 2,
      }),
    );
    expect(p.layers).toEqual([
      "instructions",
      "setting",
      "notes",
      "characters",
      "story-so-far",
      "used-scenes",
      "recent-chapters",
      "previous-tail",
      "chapter",
      "direction",
    ]);
    const body = user(p);
    const order = [
      "## Setting",
      "## Pinned story notes",
      "## Characters in the scene",
      "## The story so far",
      "## Scenes already used",
      "## Recent chapters",
      "## End of the previous chapter",
      "## Chapter 2 so far",
      "## Next block",
    ].map((h) => body.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves out the phase 4 layers and empty notes in phase 3", async () => {
    const p = buildPrompt(await input({ notes: [] }));
    expect(p.layers).toEqual(["instructions", "setting", "characters", "chapter", "direction"]);
  });

  it("sends the setting file with its background", async () => {
    const body = user(buildPrompt(await input()));
    expect(body).toContain("language: English");
    expect(body).toContain("Nine peaks float above a sea of clouds.");
    expect(body).toContain("- Lin Feng owes the sect a life debt.");
  });

  it("sends the blocks so far in full and the direction last", async () => {
    const body = user(buildPrompt(await input({ blocks: ["First block.", "Second block."] })));
    expect(body).toContain("## Chapter 1 so far\nFirst block.\n\nSecond block.");
    expect(body).toContain("## Next block\nStory arc:");
    expect(body.trimEnd().endsWith("\nDirection: He meets Su Mei at the gate.")).toBe(true);
  });

  it("says the chapter has not started and asks for an opening when there is no direction", async () => {
    const body = user(buildPrompt(await input({ direction: " " })));
    expect(body).toContain("(Nothing yet. The next block opens the chapter.)");
    expect(body).toContain("Direction: none given.");
  });

  it("asks a later chapter without a direction to open where the last one left off (decision 65)", async () => {
    const body = user(buildPrompt(await input({ chapter: 3, direction: "" })));
    expect(body).toContain(
      "Direction: none given. Open the chapter where the previous one left off, with a situation the story has not had yet.",
    );
    const mid = user(buildPrompt(await input({ chapter: 3, direction: "", blocks: ["One."] })));
    expect(mid).toContain("Direction: none given. Carry the chapter on in the way that fits it best.");
  });

  it("adds the regenerate hint after the direction (spec 5.2)", async () => {
    const body = user(buildPrompt(await input({ hint: " make the fight shorter " })));
    expect(body).toContain("Direction: He meets Su Mei at the gate.\nHint for this version: make the fight shorter");
  });
});

describe("buildPrompt instructions (layer 1)", () => {
  it("includes the genre's prompt fragments", async () => {
    const text = system(buildPrompt(await input()));
    for (const fragment of cultivation.prompt) expect(text).toContain(fragment);
  });

  it("asks every block to bring something new (spec 6.4)", async () => {
    expect(system(buildPrompt(await input()))).toContain(
      "Every block brings something new: a place, a fact, a choice or a consequence.",
    );
  });

  it("names the language, point of view, tone, detail and content rating", async () => {
    const i = await input();
    Object.assign(i.setting.values, {
      language: "简体中文 (Simplified Chinese)",
      point_of_view: "Main character, first person",
      tone: ["Dark", "Humorous"],
      narration_detail: "Brief",
      content_rating: "Mature",
    });
    const text = system(buildPrompt(i));
    expect(text).toContain("Language: write the story and the suggested actions in 简体中文 (Simplified Chinese).");
    expect(text).toContain("first person, told by the main character, Lin Feng");
    // Choices in the novel's language (decision 84).
    expect(text).toContain("Tone: 黑暗, 幽默.");
    expect(text).toContain("Narration detail: 简洁.");
    expect(text).toContain("Intimate scenes always fade to black."); // decision 15
  });

  it("adds the native-prose notes after How to write for a language other than English (spec 6.5)", async () => {
    const i = await input();
    i.setting.values.language = "繁體中文 (Traditional Chinese)";
    const text = system(buildPrompt(i));
    expect(text).toContain("## Writing in 繁體中文 (Traditional Chinese)\n- Write as a native 繁體中文 (Traditional Chinese) novelist");
    expect(text.indexOf("## How to write")).toBeLessThan(text.indexOf("## Writing in"));
    expect(text.indexOf("## Writing in")).toBeLessThan(text.indexOf("## Genre"));
    expect(text).toContain("例如「Lin Feng去問個清楚」");
    expect(system(buildPrompt(await input()))).not.toContain("## Writing in");
  });

  it.each([
    ["Never", /never dies in this story, even if a direction asks for it/],
    ["Only when I direct it", /dies only if the user's direction for this block explicitly says so/],
    ["The AI may decide", /may die when the story and the cruelty of the world call for it/],
  ])("states the main character death rule %s (spec 5.5)", async (setting, rule) => {
    const i = await input();
    i.setting.values.main_character_death = setting;
    expect(system(buildPrompt(i))).toMatch(rule);
  });

  it("falls back to safe defaults for unknown setting values", async () => {
    const i = await input();
    Object.assign(i.setting.values, { point_of_view: "?", content_rating: "?", main_character_death: "?", tone: [] });
    const text = system(buildPrompt(i));
    expect(text).toContain("third person, staying close to the main character");
    expect(text).toContain("Content rating: General.");
    expect(text).toMatch(/dies only if the user's direction/);
    expect(text).not.toContain("Tone:");
  });

  it("asks for the block response format (spec 6.3)", async () => {
    const text = system(buildPrompt(await input()));
    expect(text).toContain("\n=== NEXT ===\n");
    expect(text).toContain("MAIN CHARACTER DIED: yes");
  });

  it("asks for a mood line, none for most blocks, with every mood explained (spec 13.1)", async () => {
    const text = system(buildPrompt(await input()));
    expect(text).toContain("for most blocks write `MOOD: none`");
    for (const mood of ["tense", "battle", "reveal", "sad", "triumphant", "romantic"]) expect(text).toContain(`\`MOOD: ${mood}\`: `);
  });

  it("says what is not a peak and how often a mood is right (decision 139)", async () => {
    const text = system(buildPrompt(await input()));
    expect(text).toContain("Ordinary suspense, hiding, sneaking, searching, travel, talk, clues and worry are not peaks");
    expect(text).toContain("about one block in four has a mood");
    expect(text).toContain("`MOOD: tense`: a fight or capture about to break out in this very block");
  });

  it("asks the epilogue for a happy or sad mood (spec 13.2)", async () => {
    const text = system(buildPrompt(await input({ epilogue: { mainCharacterDied: false } })));
    expect(text).toContain("`MOOD: triumphant` if the story ends happily");
  });
});

describe("buildPrompt characters in the scene (spec 6.1)", () => {
  it("sends the main character and the characters named in the direction, not the others", async () => {
    const p = buildPrompt(await input());
    expect(p.scene).toEqual(["Lin Feng", "Su Mei"]);
    expect(user(p)).toContain("### Lin Feng (main character)");
    expect(user(p)).toContain("### Su Mei\n");
    expect(user(p)).not.toContain("Elder Wu");
  });

  it("finds names in the blocks so far, the hint and the previous chapter's summary", async () => {
    expect(buildPrompt(await input({ direction: "", blocks: ["Elder Wu frowned."] })).scene).toContain("Elder Wu");
    expect(buildPrompt(await input({ direction: "", hint: "less Elder Wu" })).scene).toContain("Elder Wu");
    expect(
      buildPrompt(await input({ direction: "", chapterSummaries: ["Su Mei left.", "Elder Wu returned."] })).scene,
    ).toEqual(["Lin Feng", "Elder Wu"]);
  });

  it("does not send the relationship field for the main character", async () => {
    const body = user(buildPrompt(await input()));
    const mainFile = body.slice(body.indexOf("### Lin Feng"), body.indexOf("### Su Mei"));
    expect(mainFile).not.toContain("relationship:");
    expect(body.slice(body.indexOf("### Su Mei"))).toContain("relationship:");
  });
});

describe("buildPrompt budget levels (spec 6.2)", () => {
  it("has the caps of the spec table", () => {
    expect(BUDGETS.lean).toMatchObject({ storySummaryTokens: 600, usedScenesTokens: 200, recentSummaries: 1, previousTailWords: 0 });
    expect(BUDGETS.balanced).toMatchObject({ storySummaryTokens: 1000, usedScenesTokens: 300, recentSummaries: 3, previousTailWords: 300 });
    expect(BUDGETS.rich).toMatchObject({ storySummaryTokens: 1500, usedScenesTokens: 450, recentSummaries: 5, previousTailWords: 600 });
  });

  it("sends the used scenes with the rule not to stage them again (spec 6.4)", async () => {
    const body = user(buildPrompt(await input({ usedScenes: ["A duel on the cliff", "A rescue in the storm"] })));
    expect(body).toContain(
      "## Scenes already used\nThese scenes have already happened in this story. Do not stage them again in a new form; move the story to situations it has not had yet.\n- A duel on the cliff\n- A rescue in the storm",
    );
    expect(buildPrompt(await input({ usedScenes: [] })).layers).not.toContain("used-scenes");
  });

  it("keeps only the newest used scenes that fit the budget's cap, in their order (spec 6.4)", async () => {
    // Each line is 9 words: 12 tokens, plus 1 for the line.
    const usedScenes = Array.from({ length: 40 }, (_, i) => `Scene ${String(i).padStart(2, "0")} a b c d e f g`);
    const sent = (budget: PromptInput["budget"]) => user(buildPrompt({ ...base, budget, usedScenes })).match(/^- Scene \d+/gm) ?? [];
    const base = await input();
    expect(sent("lean")).toHaveLength(15);
    expect(sent("lean")[0]).toBe("- Scene 25");
    expect(sent("lean").at(-1)).toBe("- Scene 39");
    expect(sent("balanced")).toHaveLength(23);
    expect(sent("rich")).toHaveLength(34);
  });

  it("sends header fields only on Lean, and the full file on Balanced and Rich", async () => {
    const background = "An orphan raised by the Azure Cloud Sect.";
    expect(user(buildPrompt(await input({ budget: "lean" })))).not.toContain(background);
    expect(user(buildPrompt(await input({ budget: "lean" })))).toContain("name: Lin Feng");
    expect(user(buildPrompt(await input({ budget: "balanced" })))).toContain(background);
    expect(user(buildPrompt(await input({ budget: "rich" })))).toContain(background);
  });

  it("sends only the most recent chapter summaries the budget allows", async () => {
    const chapterSummaries = ["S1", "S2", "S3", "S4", "S5", "S6"];
    const recent = (budget: PromptInput["budget"]) => {
      const body = user(buildPrompt({ ...base, budget, chapterSummaries }));
      return body.slice(body.indexOf("## Recent chapters"), body.indexOf("## Chapter"));
    };
    const base = await input();
    expect(recent("lean")).toMatch(/S6/);
    expect(recent("lean")).not.toMatch(/S5/);
    expect(recent("balanced")).toMatch(/S4\n\nS5\n\nS6/);
    expect(recent("balanced")).not.toMatch(/S3/);
    expect(recent("rich")).toMatch(/S2\n\nS3\n\nS4\n\nS5\n\nS6/);
    expect(recent("rich")).not.toMatch(/S1/);
  });

  it("sends the previous chapter's last words up to the budget, none on Lean", async () => {
    const previousChapter = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(" ");
    const lean = buildPrompt(await input({ budget: "lean", previousChapter }));
    expect(lean.layers).not.toContain("previous-tail");
    const balanced = user(buildPrompt(await input({ budget: "balanced", previousChapter })));
    expect(balanced).toContain("…w700 w701");
    expect(balanced).not.toContain("w699 ");
  });

  it("falls back to Balanced for an unknown budget", async () => {
    const i = await input({ budget: "huge" as PromptInput["budget"], chapterSummaries: ["S1", "S2", "S3", "S4"] });
    expect(user(buildPrompt(i))).not.toContain("S1");
  });
});

describe("buildPrompt story length and chapter length (spec 5.3, 5.7)", () => {
  const words = (n: number) => Array(n).fill("word").join(" ");

  it("states the story length in the instructions and the arc stage next to the direction", async () => {
    const i = await input({ chapter: 7 });
    i.setting.values.story_length = "Short story";
    const p = buildPrompt(i);
    expect(system(p)).toContain("Story length: a short story of about 8 chapters");
    expect(user(p)).toContain("## Next block\nStory arc: Chapter 7 of about 8, one of the last two: steer toward the finale");
  });

  it("says a continuous story has no planned end (the default)", async () => {
    const p = buildPrompt(await input());
    expect(system(p)).toContain("Story length: continuous, with no planned end.");
    expect(user(p)).toContain("Story arc: Chapter 1 of a continuous story");
  });

  it("reports the chapter's length, steers to an ending at the target and concludes at the hard limit", async () => {
    const i = await input();
    i.setting.values.chapter_length = "Short";
    expect(user(buildPrompt({ ...i, blocks: [words(400)] }))).toContain("Chapter length: 400 of about 1500 words so far.");
    expect(user(buildPrompt({ ...i, blocks: [words(400)] }))).not.toContain("steer toward a natural chapter ending");
    expect(user(buildPrompt({ ...i, blocks: [words(1600)] }))).toContain("steer toward a natural chapter ending");
    const hard = user(buildPrompt({ ...i, blocks: [words(2300)] }));
    expect(hard).toContain("This block is the chapter's conclusion");
    expect(hard).not.toContain("steer toward a natural chapter ending");
  });

  it("counts characters for a Chinese story", async () => {
    const i = await input({ blocks: ["林风抬起头。"] });
    i.setting.values.language = "简体中文 (Simplified Chinese)";
    expect(user(buildPrompt(i))).toContain("Chapter length: 6 of about 4000 characters so far.");
  });
});

describe("buildPrompt earlier chapters (spec 6.1, 6.2)", () => {
  it("adds the characters named in the last 3 chapters on Rich only", async () => {
    const recentChapters = ["Elder Wu taught him.", "x", "y", "z"];
    expect(buildPrompt(await input({ direction: "", budget: "rich", recentChapters: recentChapters.slice(0, 3) })).scene).toContain("Elder Wu");
    expect(buildPrompt(await input({ direction: "", budget: "rich", recentChapters })).scene).not.toContain("Elder Wu");
    expect(buildPrompt(await input({ direction: "", budget: "balanced", recentChapters })).scene).not.toContain("Elder Wu");
  });

  it("cuts the previous chapter's tail in characters for Chinese", async () => {
    const i = await input({ previousChapter: "林".repeat(1000) + "风".repeat(500) });
    i.setting.values.language = "简体中文 (Simplified Chinese)";
    expect(user(buildPrompt(i))).toContain("## End of the previous chapter\n…" + "风".repeat(500) + "\n");
  });
});

describe("buildPrompt epilogue (spec 5.5)", () => {
  it("asks for the final chapter at the Short length, without the block format, death rule or current chapter", async () => {
    const p = buildPrompt(await input({ direction: "", epilogue: { mainCharacterDied: false } }));
    expect(system(p)).toContain("Write the epilogue: the story's final chapter, in one piece, about 1500 words long.");
    expect(system(p)).toContain("Bring the story to its close: show where Lin Feng");
    expect(system(p)).not.toContain("=== NEXT ===");
    expect(system(p)).not.toMatch(/dies only if/);
    expect(p.layers).not.toContain("chapter");
    expect(user(p)).toContain("## The epilogue\nDirection: none given. Close the story");
    expect(user(p)).not.toContain("Story arc:");
  });

  it("speaks of the death after an accepted death", async () => {
    const p = buildPrompt(await input({ epilogue: { mainCharacterDied: true } }));
    expect(system(p)).toContain("The main character, Lin Feng, died at the end of the last chapter.");
  });

  it("keeps the native-prose notes but not the suggested action note (spec 6.5)", async () => {
    const i = await input({ epilogue: { mainCharacterDied: false } });
    i.setting.values.language = "繁體中文 (Traditional Chinese)";
    const text = system(buildPrompt(i));
    expect(text).toContain("避免翻譯腔");
    expect(text).not.toContain("建議行動");
  });
});

describe("request size (phase 5 acceptance checks 1 and 2, spec 6.2)", () => {
  const words = (n: number, w = "word") => Array(n).fill(w).join(" ");
  const size = (p: ReturnType<typeof buildPrompt>) => JSON.stringify(p.messages).length;
  /** A story at the given chapter: realistic sizes for every layer (spec 6.2 table). */
  async function atChapter(chapter: number, budget: PromptInput["budget"]) {
    const finished = chapter - 1;
    return buildPrompt(
      await input({
        budget,
        chapter,
        blocks: [words(450), words(450), words(450), words(450)],
        // The story so far grows until the End Chapter call keeps it at its cap (about 750 words on Balanced).
        storySummary: words(Math.min(150 * finished, 750), "past"),
        // Four scenes a chapter; past the cap only the newest are sent (spec 6.4).
        usedScenes: Array.from({ length: finished * 4 }, () => "A scene of this story with a few words"),
        // Same-width words (ch01, ch02…) so only the number of summaries changes the size.
        chapterSummaries: Array.from({ length: finished }, (_, i) => words(150, `ch${String(i + 1).padStart(2, "0")}`)),
        previousChapter: words(2500, "prev"),
        recentChapters: Array.from({ length: Math.min(finished, 3) }, () => words(2500, "prev")),
        characters: [main, { ...mei, background: words(200, "past") }, { ...elder, background: words(200, "past") }],
        direction: "Su Mei and Elder Wu argue at the gate.",
      }),
    );
  }

  it("grows from Lean to Balanced to Rich, as the table describes", async () => {
    const lean = await atChapter(6, "lean");
    const balanced = await atChapter(6, "balanced");
    const rich = await atChapter(6, "rich");
    expect(size(lean)).toBeLessThan(size(balanced));
    expect(size(balanced)).toBeLessThan(size(rich));
    // Lean: 1 summary, no tail, header-only characters. Rich: 5 summaries and a 600-word tail.
    expect(user(lean)).not.toContain("ch04");
    expect(user(lean)).toContain("ch05");
    expect(user(lean)).not.toContain("End of the previous chapter");
    expect(user(balanced).match(/\bprev\b/g)).toHaveLength(300);
    expect(user(rich).match(/\bprev\b/g)).toHaveLength(600);
    expect(user(rich)).toContain("ch01");
  });

  it("stays flat as the story grows: chapter 10 is close to chapter 2", async () => {
    const ch2 = size(await atChapter(2, "balanced"));
    const ch10 = size(await atChapter(10, "balanced"));
    const ch30 = size(await atChapter(30, "balanced"));
    expect(ch10 / ch2).toBeLessThan(1.5);
    // Past the caps nothing grows any more; only the chapter numbers in the text differ.
    expect(Math.abs(ch30 - ch10)).toBeLessThan(50);
  });
});

describe("choice values in the novel's language (spec 6.5, decision 84)", () => {
  async function inLanguage(language: string) {
    const base = await input();
    const setting = { ...base.setting, values: { ...base.setting.values, language, tone: ["Happy", "Dark"], narration_detail: "Brief" } };
    return buildPrompt({ ...base, setting });
  }

  it("sends the setting's and characters' choices in Traditional Chinese, field keys in English", async () => {
    const p = await inLanguage("繁體中文 (Traditional Chinese)");
    expect(system(p)).toContain("Tone: 輕鬆, 黑暗.");
    expect(system(p)).toContain("Narration detail: 簡潔.");
    expect(user(p)).toContain("tone: [輕鬆, 黑暗]");
    expect(user(p)).toContain("point_of_view: 第三人稱（主角）");
    expect(user(p)).toContain("gender: 男");
    expect(user(p)).toContain("status: 在世");
    expect(user(p)).not.toContain("Happy");
  });

  it("uses Simplified Chinese for a Simplified Chinese story", async () => {
    const p = await inLanguage("简体中文 (Simplified Chinese)");
    expect(system(p)).toContain("Tone: 轻松, 黑暗.");
    expect(user(p)).toContain("status: 在世");
  });

  it("keeps English values for English and for languages from before phase 6", async () => {
    for (const language of ["English", "日本語 (Japanese)"]) {
      const p = await inLanguage(language);
      expect(system(p)).toContain("Tone: Happy, Dark.");
      expect(user(p)).toContain("gender: Male");
    }
  });

  it("leaves the setting itself unchanged", async () => {
    const base = await input();
    base.setting.values.language = "繁體中文 (Traditional Chinese)";
    buildPrompt(base);
    expect(base.setting.values.point_of_view).toBe("Main character, third person");
  });
});
