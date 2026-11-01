import { describe, expect, it } from "vitest";
import {
  chapterDir,
  chapterEnded,
  listChapters,
  loadStoryContext,
  readChapterSummary,
  readChapterText,
  readStorySummary,
  readUsedScenes,
  renameChapter,
  saveChapterSummary,
  saveChapterText,
  saveStorySummary,
  saveUsedScenes,
  snapshotChapter,
} from "./chapters";
import { newCharacter, saveCharacter } from "./characters";
import { loadSetting, saveSetting } from "./setting";
import { store } from "./storage";
import { createStory, storyDir } from "./stories";
import { getStoryType } from "./storyTypes";

const ID = "s1";

describe("chapter files (spec 3, 5.4)", () => {
  it("uses three-digit folders", () => {
    expect(chapterDir(ID, 1)).toBe("stories/s1/chapters/001");
    expect(chapterDir(ID, 12)).toBe("stories/s1/chapters/012");
  });

  it("saves the chapter text once and never overwrites it", async () => {
    expect(await chapterEnded(ID, 1)).toBe(false);
    await saveChapterText(ID, 1, "  The bell rang.\n\nLin Feng woke.  ");
    expect(await chapterEnded(ID, 1)).toBe(true);
    expect(await readChapterText(ID, 1)).toBe("The bell rang.\n\nLin Feng woke.");
    await expect(saveChapterText(ID, 1, "Changed")).rejects.toThrow("Chapter 1 is already saved and cannot be changed.");
    expect(await readChapterText(ID, 1)).toBe("The bell rang.\n\nLin Feng woke.");
  });

  it("keeps the title in the summary's header, and renames without touching the summary", async () => {
    await saveChapterSummary(ID, 1, { title: "The Gate", summary: "He arrived." });
    expect(await store.readText(`${chapterDir(ID, 1)}/summary.md`)).toBe("---\ntitle: The Gate\n---\n\nHe arrived.\n");
    await renameChapter(ID, 1, "At the Gate");
    expect(await readChapterSummary(ID, 1)).toEqual({ title: "At the Gate", summary: "He arrived.", openings: [] });
  });

  it("keeps the next chapter's openings in the summary's header, also through a rename (decision 65)", async () => {
    await saveChapterSummary(ID, 1, { title: "The Gate", summary: "He arrived.", openings: [" Train at dawn ", "", "Leave the sect"] });
    expect(await store.readText(`${chapterDir(ID, 1)}/summary.md`)).toContain("openings: [Train at dawn, Leave the sect]\n");
    await renameChapter(ID, 1, "At the Gate");
    expect((await readChapterSummary(ID, 1))?.openings).toEqual(["Train at dawn", "Leave the sect"]);
  });

  it("gives a default title to an empty or missing one", async () => {
    await saveChapterSummary(ID, 2, { title: " ", summary: "x" });
    expect((await readChapterSummary(ID, 2))?.title).toBe("Chapter 2");
    expect(await readChapterSummary(ID, 3)).toBeNull();
    await expect(renameChapter(ID, 3, "x")).rejects.toThrow("Chapter 3 has no summary yet");
  });

  it("lists ended chapters in order, with their titles and whether the summary exists", async () => {
    await saveChapterText(ID, 2, "Two");
    await saveChapterText(ID, 10, "Ten");
    await saveChapterText(ID, 1, "One");
    await saveChapterSummary(ID, 1, { title: "First", summary: "s" });
    await store.writeText(`${storyDir(ID)}/chapters/004/summary.md`, "orphan"); // no chapter.md: not ended
    await store.writeText(`${storyDir(ID)}/chapters/notes.txt`, "x");
    expect(await listChapters(ID)).toEqual([
      { number: 1, title: "First", hasSummary: true },
      { number: 2, title: "Chapter 2", hasSummary: false },
      { number: 10, title: "Chapter 10", hasSummary: false },
    ]);
  });

  it("still lists a chapter whose summary.md is broken", async () => {
    await saveChapterText(ID, 1, "One");
    await store.writeText(`${chapterDir(ID, 1)}/summary.md`, "---\n[broken\n---\nx");
    expect(await listChapters(ID)).toEqual([{ number: 1, title: "Chapter 1", hasSummary: false }]);
  });

  it("reads and writes the story so far", async () => {
    expect(await readStorySummary(ID)).toBe("");
    await saveStorySummary(ID, " Lin Feng left home. ");
    expect(await readStorySummary(ID)).toBe("Lin Feng left home.");
  });
});

describe("snapshot (spec 5.4 step 4, decision 12)", () => {
  it("copies setting.md and every character file, and replaces an older snapshot", async () => {
    let story = await createStory({ title: "T", type: "cultivation", language: "English" });
    const setting = await loadSetting(story);
    setting.background = "Old world.";
    story = await saveSetting(story, setting);
    const main = await saveCharacter(story, newCharacter(getStoryType("cultivation"), true));
    await store.writeText(`${chapterDir(story.id, 1)}/snapshot/characters/gone.md`, "stale");

    await snapshotChapter(story.id, 1);
    const snap = `${chapterDir(story.id, 1)}/snapshot`;
    expect(await store.readText(`${snap}/setting.md`)).toContain("Old world.");
    expect(await store.readText(`${snap}/characters/${main.id}.md`)).toContain("name: Lin Feng");
    expect(await store.exists(`${snap}/characters/gone.md`)).toBe(false);

    // Later edits do not reach the snapshot.
    setting.background = "New world.";
    await saveSetting(story, setting);
    expect(await store.readText(`${snap}/setting.md`)).toContain("Old world.");
  });
});

describe("used scenes list (spec 6.4)", () => {
  it("is empty for a story without scenes.md, and saves one line per scene", async () => {
    expect(await readUsedScenes(ID)).toEqual([]);
    await saveUsedScenes(ID, [" A duel on the cliff ", "A rescue in the storm"]);
    expect(await store.readText(`${storyDir(ID)}/scenes.md`)).toBe("- A duel on the cliff\n- A rescue in the storm\n");
    expect(await readUsedScenes(ID)).toEqual(["A duel on the cliff", "A rescue in the storm"]);
    expect((await loadStoryContext(ID, 2)).usedScenes).toEqual(["A duel on the cliff", "A rescue in the storm"]);
  });

  it("reads a hand-edited file with other bullets and blank lines", async () => {
    await store.writeText(`${storyDir(ID)}/scenes.md`, "* First\n\n  - Second\nThird\n");
    expect(await readUsedScenes(ID)).toEqual(["First", "Second", "Third"]);
  });
});

describe("story context for the prompt (spec 6.1 layers 5–8)", () => {
  it("is empty before the first chapter ends", async () => {
    expect(await loadStoryContext(ID, 1)).toEqual({
      storySummary: "",
      usedScenes: [],
      chapterSummaries: [],
      previousChapter: "",
      recentChapters: [],
    });
  });

  it("holds the story so far, the summaries oldest first, the previous chapter and the last 3 chapters", async () => {
    for (let n = 1; n <= 4; n++) {
      await saveChapterText(ID, n, `Text ${n}`);
      await saveChapterSummary(ID, n, { title: `T${n}`, summary: `Summary ${n}` });
    }
    await saveStorySummary(ID, "So far.");
    const context = await loadStoryContext(ID, 5);
    expect(context.storySummary).toBe("So far.");
    expect(context.chapterSummaries).toEqual([
      'Chapter 1, "T1": Summary 1',
      'Chapter 2, "T2": Summary 2',
      'Chapter 3, "T3": Summary 3',
      'Chapter 4, "T4": Summary 4',
    ]);
    expect(context.previousChapter).toBe("Text 4");
    expect(context.recentChapters).toEqual(["Text 2", "Text 3", "Text 4"]);
  });

  it("leaves out the chapter being written and chapters without a summary", async () => {
    await saveChapterText(ID, 1, "Text 1");
    await saveChapterText(ID, 2, "Text 2");
    const context = await loadStoryContext(ID, 2);
    expect(context.chapterSummaries).toEqual([]);
    expect(context.previousChapter).toBe("Text 1");
    expect(context.recentChapters).toEqual(["Text 1"]);
  });
});

describe("chapters saved before decision 54", () => {
  it("leave out a stray flag line when read, without rewriting chapter.md", async () => {
    await saveChapterText(ID, 1, "She laughed.\n\nMAIN CHARACTER DIED: no");
    expect(await readChapterText(ID, 1)).toBe("She laughed.");
    expect(await store.readText(`${chapterDir(ID, 1)}/chapter.md`)).toContain("MAIN CHARACTER DIED: no");
  });
});

describe("chapters saved with suggestions in their text (decision 90)", () => {
  it("reads them without the marker and the suggestions; chapter.md is not rewritten", async () => {
    const saved = "第一段。\n\n轻轻偏转。=== NEXT ===\n查看山道 | 逼近矿洞\n\n第二段。";
    await saveChapterText("s1", 1, saved);
    expect(await readChapterText("s1", 1)).toBe("第一段。\n\n轻轻偏转。\n\n第二段。");
    expect(await store.readText(`${chapterDir("s1", 1)}/chapter.md`)).toContain("=== NEXT ===");
  });
});
