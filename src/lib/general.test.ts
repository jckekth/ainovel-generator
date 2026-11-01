/**
 * The General story type (phase 7b, decisions 125–128): few fields, no curated
 * sets, and no suggestions, so every block starts from the user's direction.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCK, END_CHAPTER, sentMessages, stubDefaultAi } from "../test/fixtures";
import { readChapterSummary } from "./chapters";
import { newCharacter, saveCharacter } from "./characters";
import { getSet, setsOf } from "./curatedSets";
import { loadDraft } from "./draft";
import { buildEndChapterPrompt, endChapter } from "./endChapter";
import { writeBlock } from "./novel";
import { buildPrompt } from "./prompt";
import { setApiKey } from "./secrets";
import { loadSetting, saveSetting } from "./setting";
import { DEFAULT_SETTINGS, saveSettings } from "./settings";
import { createStory } from "./stories";
import { getStoryType, hasSuggestions, STORY_TYPES } from "./storyTypes";

afterEach(() => {
  vi.unstubAllGlobals();
});

const general = getStoryType("general");

/** A General story with the user's own world and a main character who has only a name. */
async function generalStory() {
  let story = await createStory({ title: "Tea", type: "general", language: "English" });
  const doc = await loadSetting(story);
  doc.values = { ...doc.values, genre_style: "Cozy mystery in 1920s London.", world_rules: "No magic." };
  doc.background = "London, 1923. Evelyn runs a tea shop.";
  story = await saveSetting(story, doc);
  const main = newCharacter(general, true);
  await saveCharacter(story, { ...main, values: { ...main.values, name: "Evelyn" } });
  await setApiKey("sk-test");
  await saveSettings({ ...DEFAULT_SETTINGS, baseUrl: "https://api.example.com/v1", model: "gpt-test" });
  return story;
}

describe("the General type (decisions 125, 128)", () => {
  it("is the only type without suggestions", () => {
    expect(STORY_TYPES.filter((t) => !hasSuggestions(t)).map((t) => t.id)).toEqual(["general"]);
  });

  it("has no curated sets, and its setting and main character start empty", async () => {
    expect(setsOf("general")).toEqual([]);
    const story = await createStory({ title: "T", type: "general", language: "English" });
    expect(story.setId).toBeUndefined();
    expect(getSet("general", story.setId)).toBeUndefined();
    const doc = await loadSetting(story);
    expect(doc.background).toBe("");
    expect(doc.values.genre_style).toBe("");
    expect(doc.values.tone).toEqual([]);
    const main = newCharacter(general, true);
    expect(main.values.name ?? "").toBe("");
    expect(main.background).toBe("");
  });

  it("requires the genre and style, and nothing of the main character but the common fields", () => {
    expect(general.settingFields.filter((f) => f.required).map((f) => f.key)).toEqual(["genre_style"]);
    expect(general.rules.mainCharacterRequired ?? []).toEqual([]);
  });
});

describe("prompts without suggestions (decision 125)", () => {
  it("asks for no suggested actions, but keeps the marker and the death flag", async () => {
    const story = await generalStory();
    const setting = await loadSetting(story);
    const main = { ...newCharacter(general, true), id: "e", values: { name: "Evelyn" } };
    const p = buildPrompt({ storyType: general, setting, notes: [], characters: [main], budget: "balanced", chapter: 1, blocks: [], direction: "She opens the shop." });
    const system = p.messages[0].content;
    expect(system).not.toContain("suggested actions for what");
    expect(system).toContain("Do not suggest what could happen next");
    expect(system).toContain("=== NEXT ===");
    expect(system).toContain("MAIN CHARACTER DIED");
    expect(system).toContain("Language: write in English.");
  });

  it("asks the End Chapter call for no openings", () => {
    const main = { ...newCharacter(general, true), id: "e" };
    const prompt = buildEndChapterPrompt({
      type: general,
      language: "English",
      chapter: 1,
      chapterText: "The bell rang.",
      storySummary: "",
      characters: [main],
      storySummaryTokens: 1000,
      usedScenes: [],
      usedScenesTokens: 300,
    });
    const system = prompt[0].content;
    expect(system).not.toContain("next_openings");
    expect(system).toContain('"scenes": ["..."], "character_changes"');
  });
});

describe("writing a General story (decision 126)", () => {
  it("refuses a block without a direction, and shows no actions even if the AI sent some", async () => {
    stubDefaultAi();
    const story = await generalStory();
    const draft = await loadDraft(story);
    await expect(writeBlock({ story, draft, direction: "  " })).rejects.toThrow("Say what happens in this block first");

    const next = await writeBlock({ story, draft, direction: "She opens the shop." });
    // BLOCK has two suggested actions after the marker; they are dropped.
    expect(BLOCK).toContain("Knock on the gate");
    const version = next.blocks[0].versions[0];
    expect(version.actions).toEqual([]);
    expect(version.notes).toEqual([]);
    expect(version.text).toBe("Lin Feng climbed the stairs.");
  });

  it("regenerates without a new direction", async () => {
    stubDefaultAi();
    const story = await generalStory();
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "She opens the shop." });
    const again = await writeBlock({ story, draft, regenerate: { hint: "" } });
    expect(again.blocks[0].versions).toHaveLength(2);
  });

  it("saves no openings for the next chapter, even if the AI sent some", async () => {
    const fetch = stubDefaultAi();
    const story = await generalStory();
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "She opens the shop." });
    await endChapter(story, draft);
    expect(END_CHAPTER.next_openings.length).toBeGreaterThan(0);
    expect((await readChapterSummary(story.id, 1))?.openings ?? []).toEqual([]);
    expect(sentMessages(fetch, 1)[0].content).not.toContain("next_openings");
  });
});
