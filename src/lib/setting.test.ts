import { describe, expect, it } from "vitest";
import { normalize, rankOptions, validate } from "./fields";
import { parseMarkDoc } from "./markdoc";
import { hasStarted, isSettingLocked, ladderOf, loadNotes, loadSetting, saveNotes, saveSetting } from "./setting";
import { store } from "./storage";
import { createStory, getStory, storyDir, updateStory } from "./stories";
import { getStoryType, settingFields } from "./storyTypes";
import { getSet, setBackground } from "./curatedSets";

const newStory = (type = "cultivation", language = "English") => createStory({ title: "Test", type, language });

describe("setting.md", () => {
  it("starts from the story type defaults, the story's set and the story's language (spec 8)", async () => {
    // A language from before phase 6 still works, with the set's English text.
    const story = await createStory({ title: "Test", type: "romance", language: "Bahasa Melayu", setId: "harbour-cafe" });
    const doc = await loadSetting(story);
    expect(doc.saved).toBe(false);
    expect(doc.setId).toBe("harbour-cafe");
    expect(doc.background).toBe(setBackground(getSet("romance", "harbour-cafe")!, "English"));
    expect(doc.values).toMatchObject({
      language: "Bahasa Melayu",
      chapter_length: "Medium",
      main_character_death: "Only when I direct it",
      trope: "Slow burn",
      era_and_place_details: "A busy coastal city in the present day",
    });
  });

  it.each(["cultivation", "romance"])("starts %s stories with a setting that passes validation untouched (decision 44)", async (type) => {
    const doc = await loadSetting(await newStory(type));
    const fields = settingFields(getStoryType(type));
    const values = normalize(fields, doc.values);
    const required = new Set(fields.filter((f) => f.required).map((f) => f.key));
    expect(validate(fields, values, { required, hidden: new Set(), rankOptions: rankOptions(ladderOf(values)) })).toEqual({});
    expect(doc.background.trim()).not.toBe("");
  });

  it("gives cultivation stories the default rank ladder (spec 8.3)", async () => {
    const doc = await loadSetting(await newStory());
    expect(ladderOf(doc.values).length).toBeGreaterThan(1);
    expect(ladderOf({ rank_ladder: "junk" })).toEqual([]);
  });

  it("saves readable markdown and reopens it intact", async () => {
    const story = await newStory();
    const doc = await loadSetting(story);
    doc.values.tone = ["Dark", "Hot-blooded"];
    doc.values.sects_and_factions = ["  Azure Cloud Sect ", ""];
    doc.background = "A world of floating mountains.";
    await saveSetting(story, doc);

    const raw = await store.readText(`${storyDir(story.id)}/setting.md`);
    expect(raw.startsWith("---\nlanguage: English\n")).toBe(true);
    expect(raw).toContain("tone: [Dark, Hot-blooded]");
    expect(raw.trimEnd().endsWith("A world of floating mountains.")).toBe(true);

    const reopened = await loadSetting(story);
    expect(reopened.saved).toBe(true);
    expect(reopened.background).toBe("A world of floating mountains.");
    expect(reopened.values.sects_and_factions).toEqual(["Azure Cloud Sect"]);
    expect(reopened.values.tone).toEqual(["Dark", "Hot-blooded"]);
  });

  it("updates the language in story.json too (decision 31)", async () => {
    const story = await newStory();
    const doc = await loadSetting(story);
    doc.values.language = "日本語 (Japanese)";
    const updated = await saveSetting(story, doc);
    expect(updated.language).toBe("日本語 (Japanese)");
    expect((await getStory(story.id)).language).toBe("日本語 (Japanese)");
  });

  it("keeps header keys it does not know", async () => {
    const story = await newStory();
    await store.writeText(`${storyDir(story.id)}/setting.md`, "---\nmagic_system: runes\n---\nBody");
    const doc = await loadSetting(story);
    expect(doc.extra).toEqual({ magic_system: "runes" });
    expect(doc.values.language).toBe("English");
    await saveSetting(story, doc);
    expect(parseMarkDoc(await store.readText(`${storyDir(story.id)}/setting.md`)).header.magic_system).toBe("runes");
  });
});

describe("setting lock (spec 8.1)", () => {
  const draft = (id: string) => `${storyDir(id)}/draft/draft.json`;

  it("is unlocked without a draft", async () => {
    expect(await isSettingLocked((await newStory()).id)).toBe(false);
  });

  it("is locked while the draft has blocks", async () => {
    const { id } = await newStory();
    await store.writeText(draft(id), JSON.stringify({ blocks: [{ text: "..." }] }));
    expect(await isSettingLocked(id)).toBe(true);
  });

  it("is unlocked for an empty or corrupt draft", async () => {
    const { id } = await newStory();
    await store.writeText(draft(id), JSON.stringify({ blocks: [] }));
    expect(await isSettingLocked(id)).toBe(false);
    await store.writeText(draft(id), "{oops");
    expect(await isSettingLocked(id)).toBe(false);
  });
});

describe("pinned story notes (decision 18)", () => {
  it("is empty when there is no notes file", async () => {
    expect(await loadNotes((await newStory()).id)).toEqual([]);
  });

  it("saves a markdown list and drops blank notes", async () => {
    const { id } = await newStory();
    await saveNotes(id, ["  Lin Feng owes a life debt. ", "", "The well hides a demon."]);
    expect(await store.readText(`${storyDir(id)}/notes.md`)).toBe("- Lin Feng owes a life debt.\n- The well hides a demon.\n");
    expect(await loadNotes(id)).toEqual(["Lin Feng owes a life debt.", "The well hides a demon."]);
  });

  it("reads a hand-edited file with * bullets, plain lines and CRLF", async () => {
    const { id } = await newStory();
    await store.writeText(`${storyDir(id)}/notes.md`, "* one\r\n\r\n  - two\r\nthree\r\n");
    expect(await loadNotes(id)).toEqual(["one", "two", "three"]);
  });
});

describe("curated sets in the setting (spec 8, decision 85)", () => {
  it("shows the same set on every visit until the setting is saved", async () => {
    const story = await createStory({ title: "T", type: "cultivation", language: "English" });
    const first = await loadSetting(story);
    const again = await loadSetting(await getStory(story.id));
    expect(again.background).toBe(first.background);
    expect(again.setId).toBe(story.setId);
  });

  it("starts a Chinese story's setting in its own script", async () => {
    const story = await createStory({ title: "T", type: "cultivation", language: "繁體中文 (Traditional Chinese)", setId: "nine-peaks" });
    const doc = await loadSetting(story);
    expect(doc.background).toContain("九座巨峰");
    expect((doc.values.sects_and_factions as string[])[0]).toContain("青雲劍宗");
    expect(doc.values.language).toBe("繁體中文 (Traditional Chinese)");
  });

  it("saves the set the values came from, e.g. after Randomize", async () => {
    const story = await createStory({ title: "T", type: "romance", language: "English", setId: "harbour-cafe" });
    const doc = await loadSetting(story);
    const saved = await saveSetting(story, { ...doc, setId: "tower-office" });
    expect(saved.setId).toBe("tower-office");
    expect((await getStory(story.id)).setId).toBe("tower-office");
    expect((await loadSetting(saved)).setId).toBe("tower-office");
  });

  it("gives a story from before sets the type's first set", async () => {
    const story = await createStory({ title: "T", type: "romance", language: "English" });
    delete story.setId;
    expect((await loadSetting(story)).setId).toBe("harbour-cafe");
  });
});

describe("the language is fixed once the story has started (decision 89)", () => {
  const blockDraft = (chapter: number) =>
    JSON.stringify({ chapter, blocks: [{ direction: "", chosen: 0, versions: [{ text: "x", actions: [], died: false, hint: "", createdAt: "" }] }] });

  it("counts a story as started from its first block, or once a chapter has ended", async () => {
    const story = await newStory();
    expect(await hasStarted(story)).toBe(false);
    await store.writeText(`${storyDir(story.id)}/draft/draft.json`, blockDraft(1));
    expect(await hasStarted(story)).toBe(true);
    await store.remove(`${storyDir(story.id)}/draft/draft.json`);
    expect(await hasStarted({ ...story, chapterCount: 1 })).toBe(true);
  });

  it("lets the language change freely before the story starts", async () => {
    const story = await newStory();
    const doc = await loadSetting(story);
    const saved = await saveSetting(story, { ...doc, values: { ...doc.values, language: "繁體中文 (Traditional Chinese)" } });
    expect(saved.language).toBe("繁體中文 (Traditional Chinese)");
  });

  it("refuses a new language once a chapter has ended, and still saves other changes", async () => {
    let story = await newStory();
    const doc = await loadSetting(story);
    story = await saveSetting(story, doc);
    story = await updateStory(story.id, { chapterCount: 1 });
    await expect(
      saveSetting(story, { ...doc, values: { ...doc.values, language: "简体中文 (Simplified Chinese)" } }),
    ).rejects.toThrow("The novel's language is fixed once the story has started");
    expect((await getStory(story.id)).language).toBe("English");
    const saved = await saveSetting(story, { ...doc, values: { ...doc.values, chapter_length: "Long" } });
    expect((await loadSetting(saved)).values.chapter_length).toBe("Long");
  });

  it("reads the story from disk, so a stale story object cannot slip a change through", async () => {
    const story = await newStory();
    const doc = await loadSetting(story);
    await store.writeText(`${storyDir(story.id)}/draft/draft.json`, blockDraft(1));
    await expect(saveSetting(story, { ...doc, values: { ...doc.values, language: "简体中文 (Simplified Chinese)" } })).rejects.toThrow(
      "fixed once the story has started",
    );
  });
});
