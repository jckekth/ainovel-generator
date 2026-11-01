import { describe, expect, it } from "vitest";
import {
  addVersion,
  appendBlock,
  BlockVersion,
  chapterTexts,
  chooseVersion,
  deleteDraft,
  Draft,
  draftPath,
  emptyDraft,
  loadDraft,
  saveDraft,
} from "./draft";
import { isSettingLocked } from "./setting";
import { store } from "./storage";
import { createStory, updateStory } from "./stories";

const newStory = () => createStory({ title: "Draft test", type: "cultivation", language: "English" });

const version = (text: string, hint = ""): BlockVersion => ({
  text,
  actions: ["Go on"],
  died: false,
  hint,
  createdAt: "2026-10-07T00:00:00.000Z",
});

describe("draft changes (spec 5.2)", () => {
  const start: Draft = { chapter: 1, blocks: [] };

  it("appends blocks with their directions", () => {
    const d = appendBlock(appendBlock(start, "", version("One")), "  Go north ", version("Two"));
    expect(d.blocks.map((b) => b.direction)).toEqual(["", "Go north"]);
    expect(chapterTexts(d)).toEqual(["One", "Two"]);
    expect(start.blocks).toEqual([]); // pure: the input is not changed
  });

  it("keeps earlier versions of the latest block and chooses the new one", () => {
    let d = appendBlock(start, "Go", version("One"));
    d = addVersion(d, version("One, again", "shorter"));
    d = addVersion(d, version("One, third"));
    expect(d.blocks[0].versions.map((v) => v.text)).toEqual(["One", "One, again", "One, third"]);
    expect(d.blocks[0].chosen).toBe(2);
    expect(d.blocks[0].versions[1].hint).toBe("shorter");
    expect(chapterTexts(d)).toEqual(["One, third"]);
  });

  it("switches back to an earlier version", () => {
    const d = chooseVersion(addVersion(appendBlock(start, "Go", version("One")), version("Two")), 0);
    expect(chapterTexts(d)).toEqual(["One"]);
    expect(() => chooseVersion(d, 2)).toThrow("That version of the block does not exist.");
    expect(() => chooseVersion(d, -1)).toThrow();
  });

  it("fixes the chosen version once the next block is written (decision 39)", () => {
    let d = appendBlock(start, "Go", version("A1"));
    d = addVersion(d, version("A2"));
    d = chooseVersion(d, 0);
    d = appendBlock(d, "Next", version("B1"));
    expect(d.blocks[0].versions.map((v) => v.text)).toEqual(["A1"]);
    expect(d.blocks[0].chosen).toBe(0);
    expect(chapterTexts(d)).toEqual(["A1", "B1"]);
  });

  it("only ever changes the latest block", () => {
    let d = appendBlock(appendBlock(start, "", version("A")), "", version("B"));
    d = addVersion(d, version("B2"));
    expect(d.blocks[0].versions).toHaveLength(1);
    expect(d.blocks[1].versions).toHaveLength(2);
  });

  it("refuses to regenerate or switch when there is no block", () => {
    expect(() => addVersion(start, version("x"))).toThrow("There is no block to change yet.");
    expect(() => chooseVersion(start, 0)).toThrow("There is no block to change yet.");
  });
});

describe("draft/draft.json (spec 3, 5.1)", () => {
  it("starts an empty draft for the next chapter when there is none", async () => {
    const story = await newStory();
    expect(await loadDraft(story)).toEqual({ chapter: 1, blocks: [] });
    const later = await updateStory(story.id, { chapterCount: 2 });
    expect(emptyDraft(later).chapter).toBe(3);
  });

  it("saves and reopens the same blocks", async () => {
    const story = await newStory();
    const d = addVersion(appendBlock({ chapter: 1, blocks: [] }, "Go", version("One")), version("Two", "hint"));
    await saveDraft(story.id, d);
    expect(await loadDraft(story)).toEqual(d);
    expect(JSON.parse(await store.readText(draftPath(story.id))).blocks).toHaveLength(1);
  });

  it("tidies a hand-edited draft", async () => {
    const story = await newStory();
    await store.writeText(
      draftPath(story.id),
      JSON.stringify({
        chapter: "x",
        blocks: [
          { direction: 5, versions: [{ text: "A", actions: ["ok", 3] }, { nope: true }], chosen: 9 },
          { versions: [] },
          null,
        ],
      }),
    );
    expect(await loadDraft(story)).toEqual({
      chapter: 1,
      blocks: [{ direction: "", versions: [{ text: "A", actions: ["ok"], died: false, hint: "", createdAt: "" }], chosen: 0 }],
    });
  });

  it("explains a corrupt draft in plain words", async () => {
    const story = await newStory();
    await store.writeText(draftPath(story.id), "{ not json");
    await expect(loadDraft(story)).rejects.toThrow(/draft\/draft.json could not be read .* delete it to start the chapter again/);
  });
});

describe("setting lock with a real draft (spec 8.1)", () => {
  it("locks the setting once the draft has a block, and not before", async () => {
    const story = await newStory();
    await saveDraft(story.id, { chapter: 1, blocks: [] });
    expect(await isSettingLocked(story.id)).toBe(false);
    await saveDraft(story.id, appendBlock({ chapter: 1, blocks: [] }, "", version("One")));
    expect(await isSettingLocked(story.id)).toBe(true);
  });
});

describe("epilogue drafts (spec 5.5, decision 52)", () => {
  it("starts the epilogue once the story is ending", async () => {
    const story = await updateStory((await newStory()).id, { ending: "choice", chapterCount: 3 });
    expect(emptyDraft(story)).toEqual({ chapter: 4, blocks: [], epilogue: true });
    expect(await loadDraft(story)).toEqual({ chapter: 4, blocks: [], epilogue: true });
  });

  it("keeps the epilogue flag through save and load, and deletes the draft", async () => {
    const story = await newStory();
    const d: Draft = { ...appendBlock({ chapter: 2, blocks: [] }, "", version("The end.")), epilogue: true };
    await saveDraft(story.id, d);
    expect(await loadDraft(story)).toEqual(d);
    await deleteDraft(story.id);
    expect(await store.exists(draftPath(story.id))).toBe(false);
  });
});

describe("blocks saved before decision 54", () => {
  it("lose a stray flag line when the draft is read", async () => {
    const story = await newStory();
    await store.writeText(
      draftPath(story.id),
      JSON.stringify({ chapter: 1, blocks: [{ direction: "", chosen: 0, versions: [{ text: "She laughed.\n\nMAIN CHARACTER DIED: no" }] }] }),
    );
    expect(chapterTexts(await loadDraft(story))).toEqual(["She laughed."]);
  });
});

describe("the mood saved with a block (spec 6.3, 13)", () => {
  it("keeps a known mood and drops an unknown one", async () => {
    const story = await newStory();
    const v = (text: string, mood: string) => ({ text, actions: [], died: false, hint: "", createdAt: "", mood });
    await store.writeText(
      draftPath(story.id),
      JSON.stringify({ chapter: 1, blocks: [{ direction: "", chosen: 0, versions: [v("A", "battle"), v("B", "calm")] }] }),
    );
    const versions = (await loadDraft(story)).blocks[0].versions;
    expect(versions[0].mood).toBe("battle");
    expect(versions[1]).not.toHaveProperty("mood");
  });
});

describe("tokens and notes in the draft (spec 6.6, decision 86)", () => {
  const v = (text: string, tokens?: { input: number; output: number; estimated?: boolean }): BlockVersion => ({
    text,
    actions: ["Go"],
    notes: ["Somewhere new"],
    died: false,
    hint: "",
    createdAt: "",
    ...(tokens ? { tokens } : {}),
  });

  it("adds every new block and version to the chapter's total, also once the version is dropped", () => {
    let draft = appendBlock({ chapter: 1, blocks: [] }, "", v("a", { input: 100, output: 10 }));
    draft = addVersion(draft, v("a2", { input: 120, output: 12 }));
    draft = appendBlock(draft, "next", v("b", { input: 150, output: 15, estimated: true }));
    expect(draft.blocks[0].versions).toHaveLength(1);
    expect(draft.tokens).toEqual({ input: 370, output: 37, estimated: true });
  });

  it("keeps the total unchanged for blocks without tokens (written before phase 6)", () => {
    expect(appendBlock({ chapter: 1, blocks: [] }, "", v("a")).tokens).toBeUndefined();
  });

  it("saves and reloads notes and tokens; an old draft loads without them", async () => {
    const story = await createStory({ title: "T", type: "cultivation", language: "English" });
    const draft = appendBlock(emptyDraft(story), "", v("a", { input: 5, output: 1 }));
    await saveDraft(story.id, draft);
    expect(await loadDraft(story)).toEqual(draft);
    await store.writeText(draftPath(story.id), JSON.stringify({ chapter: 1, blocks: [{ direction: "", chosen: 0, versions: [{ text: "x", actions: ["Go"] }] }] }));
    const old = (await loadDraft(story)).blocks[0].versions[0];
    expect(old.notes).toBeUndefined();
    expect(old.tokens).toBeUndefined();
  });
});

describe("a hand-edited draft with notes (CR6-08)", () => {
  it("drops a non-text action together with its note, so the rest stay paired", async () => {
    const story = await newStory();
    await store.writeText(
      draftPath(story.id),
      JSON.stringify({
        chapter: 1,
        blocks: [{ direction: "", chosen: 0, versions: [{ text: "x", actions: ["Run", 7, "Hide"], notes: ["Escape", "junk", "Wait it out"] }] }],
      }),
    );
    const v = (await loadDraft(story)).blocks[0].versions[0];
    expect(v.actions).toEqual(["Run", "Hide"]);
    expect(v.notes).toEqual(["Escape", "Wait it out"]);
  });
});

describe("blocks saved with the suggestions still in their text (bug 2026-10-22)", () => {
  it("are split into text, actions and notes when the draft is read", async () => {
    const story = await newStory();
    await store.writeText(
      draftPath(story.id),
      JSON.stringify({
        chapter: 1,
        blocks: [{ direction: "", chosen: 0, versions: [{ text: "轻轻偏转。=== NEXT ===\n查看山道 | 逼近矿洞\n离开", actions: [] }] }],
      }),
    );
    const v = (await loadDraft(story)).blocks[0].versions[0];
    expect(v.text).toBe("轻轻偏转。");
    expect(v.actions).toEqual(["查看山道", "离开"]);
    expect(v.notes).toEqual(["逼近矿洞", ""]);
  });
});
