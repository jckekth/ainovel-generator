import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCK, END_CHAPTER, readyStory, sentMessages, stubAi, stubDefaultAi } from "../test/fixtures";
import {
  chapterDir,
  chapterEnded,
  listChapters,
  readChapterSummary,
  readChapterText,
  readStorySummary,
  readUsedScenes,
  saveUsedScenes,
} from "./chapters";
import { Character, listCharacters, newCharacter } from "./characters";
import { draftPath, loadDraft } from "./draft";
import {
  acceptEpilogue,
  approveProposal,
  buildEndChapterPrompt,
  checkProposals,
  endChapter,
  EndChapterAnswer,
  endStory,
  finishChapter,
  formatValue,
  loadNovelState,
  loadReview,
  markAccepted,
  NewCharacterProposal,
  parseEndChapter,
  reconcileStory,
  rejectProposal,
  reviewDone,
  summarizeChapter,
  summaryInFlight,
} from "./endChapter";
import { AiStopped } from "./ai";
import { writeBlock } from "./novel";
import { loadSetting, saveSetting } from "./setting";
import { store } from "./storage";
import { getStory, Story } from "./stories";
import { getStoryType } from "./storyTypes";

afterEach(() => {
  vi.unstubAllGlobals();
});

const cultivation = getStoryType("cultivation");

describe("parseEndChapter (spec 5.4 step 2, decision 51)", () => {
  it("reads every part", () => {
    expect(parseEndChapter(JSON.stringify(END_CHAPTER))).toEqual({
      title: "The Gate",
      chapterSummary: "Lin Feng reached the gate and met Elder Wu.",
      storySummary: "Lin Feng left the clan and found a teacher.",
      scenes: ["Leaving home at night", "Meeting a hidden teacher"],
      nextOpenings: ["Lin Feng begins training at dawn", "A rival clan arrives at the gate"],
      picture: "",
      changes: [{ character: "Lin Feng", field: "condition", newValue: "Wounded", reason: "A cut." }],
      newCharacters: [{ name: "Elder Wu", fields: { age: 70 }, background: "An old teacher.", reason: "Met him." }],
    });
  });

  it("accepts a code fence and text around the JSON", () => {
    const raw = "Here it is:\n```json\n" + JSON.stringify(END_CHAPTER) + "\n```\nDone.";
    expect(parseEndChapter(raw).title).toBe("The Gate");
  });

  it("allows a missing title and missing lists, and skips list items that are not objects", () => {
    const answer = parseEndChapter(
      JSON.stringify({ chapter_summary: "a", story_summary: "b", character_changes: ["junk", null], new_characters: "x" }),
    );
    expect(answer).toMatchObject({ title: "", scenes: [], nextOpenings: [], changes: [], newCharacters: [] });
  });

  it("keeps at most three openings, and drops empty or non-text scenes and openings (decision 65, spec 6.4)", () => {
    const answer = parseEndChapter(
      JSON.stringify({ chapter_summary: "a", story_summary: "b", scenes: ["  A duel ", "", 7, null], next_openings: ["1", "2", "3", "4"] }),
    );
    expect(answer.scenes).toEqual(["A duel"]);
    expect(answer.nextOpenings).toEqual(["1", "2", "3"]);
  });

  it("explains an answer that is not JSON, or misses a summary", () => {
    expect(() => parseEndChapter("Sorry, I cannot.")).toThrow("The AI's chapter summary could not be read. Try again.");
    expect(() => parseEndChapter("{ not json }")).toThrow("could not be read");
    expect(() => parseEndChapter(JSON.stringify({ title: "x", chapter_summary: "a" }))).toThrow(
      "missing the chapter summary or the story summary",
    );
  });
});

describe("buildEndChapterPrompt", () => {
  const main: Character = { ...newCharacter(cultivation, true), id: "lin" };
  const input = {
    type: cultivation,
    language: "English",
    chapter: 3,
    chapterText: "The bell rang.",
    storySummary: "Before.",
    characters: [main],
    storySummaryTokens: 1000,
    usedScenes: ["Leaving home at night"],
    usedScenesTokens: 300,
  };

  it("asks for JSON with the summary cap in words, and sends fields, characters, the story so far and the chapter", () => {
    const [system, user] = buildEndChapterPrompt(input);
    expect(system.content).toMatch(/^You are the editor/);
    expect(system.content).toContain("Chapter 3 has just ended");
    expect(system.content).toContain("at most 750 words");
    expect(system.content).not.toContain("compress");
    expect(user.content).toContain("- status: one of Alive, Dead, Inactive");
    expect(user.content).toContain("- cultivation_rank: one of the ranks");
    expect(user.content).toContain("### Lin Feng (main character)\n---\nname: Lin Feng");
    const mainFile = user.content.slice(user.content.indexOf("### Lin Feng"), user.content.indexOf("## The story so far"));
    expect(mainFile).not.toContain("relationship:"); // hidden for the main character
    expect(user.content).toContain("## The story so far, before this chapter\nBefore.");
    expect(user.content).toContain("## Chapter 3\nThe bell rang.");
  });

  it("tells the AI a new value replaces the old one, so lasting facts are kept (decision 138)", () => {
    expect(buildEndChapterPrompt(input)[0].content).toContain(
      "new_value replaces the field's old value completely. Keep everything in the old value that is still true",
    );
  });

  it("lists a fantasy story's own races and ranks, and lets a class be written out (decisions 101, 104, 105)", () => {
    const fantasy = getStoryType("fantasy");
    const hero: Character = { ...newCharacter(fantasy, true), id: "hero" };
    const [, user] = buildEndChapterPrompt({
      ...input,
      type: fantasy,
      characters: [hero],
      picks: { race: ["Humans", "Elves"], adventurer_rank: [] },
    });
    expect(user.content).toContain("- race: one of Humans | Elves");
    // Ranks turned off: the AI is not offered the field, nor shown it on the characters (CR-01).
    expect(user.content).not.toContain("adventurer_rank");
    expect(user.content).toContain("- class: one of Warrior, Knight, Mage, Healer, Rogue, Ranger, Bard, or another one written out");
  });

  it("asks to compress the oldest events when the summary is over its cap (spec 6.1)", () => {
    const long = Array(800).fill("event").join(" ");
    expect(buildEndChapterPrompt({ ...input, storySummary: long })[0].content).toContain(
      "compress the oldest events into short arc-level lines",
    );
  });

  it("sends the used scenes and asks for the whole updated list and the next chapter's openings (spec 6.4, decision 65)", () => {
    const [system, user] = buildEndChapterPrompt(input);
    expect(system.content).toContain('"scenes": ["..."], "next_openings": ["..."]');
    expect(system.content).toContain("- scenes: the whole updated list");
    expect(system.content).toContain("At most 225 words in all.");
    expect(system.content).not.toContain("merge similar lines");
    expect(system.content).toContain("- next_openings: two or three short, different ways the next chapter could open");
    // Spec 6.5: an action, not a request such as "請陳美…".
    expect(system.content).toContain('never phrased as a request (no "Have …", "請…" or "讓…")');
    expect(user.content).toContain("## Scenes the story has already used\n- Leaving home at night");
    expect(buildEndChapterPrompt({ ...input, usedScenes: [] })[1].content).toContain(
      "## Scenes the story has already used\n(none yet)",
    );
  });

  it("asks to merge similar scenes when the list is over its cap (spec 6.4)", () => {
    const long = Array.from({ length: 60 }, (_, i) => `A long scene about a duel on the mountain, number ${i}`);
    expect(buildEndChapterPrompt({ ...input, usedScenes: long })[0].content).toContain("merge similar lines into broader ones");
  });

  it("always asks for an age for new characters, at least the minimum where the type has one (decision 67)", () => {
    expect(buildEndChapterPrompt(input)[0].content).toContain("always give an age: your best guess from the chapter.");
    const romance = getStoryType("romance");
    const lin: Character = { ...newCharacter(romance, true), id: "lin" };
    expect(buildEndChapterPrompt({ ...input, type: romance, characters: [lin] })[0].content).toContain(
      "always give an age: your best guess from the chapter, at least 18.",
    );
  });

  it("gives the cap in characters for Chinese", () => {
    expect(buildEndChapterPrompt({ ...input, language: "简体中文 (Simplified Chinese)" })[0].content).toContain(
      "at most 1000 characters",
    );
  });
});

describe("checkProposals (spec 7.5, decision 51)", () => {
  const main: Character = {
    ...newCharacter(cultivation, true),
    id: "lin",
  };
  const mei: Character = { ...newCharacter(cultivation, false), id: "mei" };
  mei.values = { ...mei.values, name: "Su Mei", status: "Alive" };
  const ranks = ["Qi Refining, Early", "Qi Refining, Middle"];
  const answer = (patch: Partial<EndChapterAnswer>): EndChapterAnswer => ({
    title: "",
    chapterSummary: "a",
    storySummary: "b",
    scenes: [],
    nextOpenings: [],
    picture: "",
    changes: [],
    newCharacters: [],
    ...patch,
  });
  const change = (character: string, field: string, newValue: unknown) => ({ character, field, newValue, reason: "r" });

  it("keeps a valid change, with the old value from the file", () => {
    const [p] = checkProposals(answer({ changes: [change("lin feng", "condition", "Wounded")] }), [main, mei], cultivation, ranks);
    expect(p).toMatchObject({
      kind: "change",
      characterId: "lin",
      characterName: "Lin Feng",
      field: "condition",
      label: "Condition",
      oldValue: "Healthy",
      newValue: "Wounded",
      status: "pending",
    });
  });

  it("drops unknown characters and fields, name changes, hidden fields and values the field does not allow", () => {
    const proposals = checkProposals(
      answer({
        changes: [
          change("Nobody", "condition", "x"),
          change("Su Mei", "wings", "x"),
          change("Su Mei", "name", "Mei Su"),
          change("Lin Feng", "relationship", "Self"), // hidden for the main character
          change("Su Mei", "status", "Ascended"),
          change("Su Mei", "cultivation_rank", "God"),
          change("Su Mei", "age", "old"),
        ],
      }),
      [main, mei],
      cultivation,
      ranks,
    );
    expect(proposals).toEqual([]);
  });

  it("drops a change to the value the character already has", () => {
    expect(checkProposals(answer({ changes: [change("Su Mei", "status", "Alive")] }), [mei], cultivation, ranks)).toEqual([]);
  });

  it("coerces values: numbers from text, lists from one string, and an emptied list is a change", () => {
    const proposals = checkProposals(
      answer({
        changes: [change("Su Mei", "age", "19"), change("Su Mei", "techniques", "Cloud Step"), change("Lin Feng", "inventory", [])],
      }),
      [main, mei],
      cultivation,
      ranks,
    );
    expect(proposals.map((p) => p.kind === "change" && [p.field, p.newValue])).toEqual([
      ["age", 19],
      ["techniques", ["Cloud Step"]],
      ["inventory", []],
    ]);
  });

  describe("in a fantasy story (decisions 104, 105, CR-01, CR-03)", () => {
    const fantasy = getStoryType("fantasy");
    const hero: Character = { ...newCharacter(fantasy, true), id: "hero" };
    hero.values = { ...hero.values, name: "Aldric", class: "Knight", race: "Humans", adventurer_rank: "Copper" };
    const picks = { race: ["Humans", "Elves"], adventurer_rank: ["Copper", "Iron"] };

    it("keeps a race or rank from the setting's lists and drops one outside them", () => {
      const proposals = checkProposals(
        answer({ changes: [change("Aldric", "adventurer_rank", "Iron"), change("Aldric", "adventurer_rank", "Platinum"), change("Aldric", "race", "Dragonkin")] }),
        [hero],
        fantasy,
        [],
        picks,
      );
      expect(proposals.map((p) => (p.kind === "change" ? p.newValue : null))).toEqual(["Iron"]);
    });

    it("drops every rank change when the story has no ranks", () => {
      const proposals = checkProposals(answer({ changes: [change("Aldric", "adventurer_rank", "Copper")] }), [hero], fantasy, [], { ...picks, adventurer_rank: [] });
      expect(proposals).toEqual([]);
    });

    it("keeps a typed class but never an empty one for the main character or an object", () => {
      const proposals = checkProposals(
        answer({ changes: [change("Aldric", "class", "Necromancer"), change("Aldric", "class", null), change("Aldric", "class", { name: "Mage" })] }),
        [hero],
        fantasy,
        [],
        picks,
      );
      expect(proposals.map((p) => (p.kind === "change" ? p.newValue : null))).toEqual(["Necromancer"]);
    });

    it("leaves a new character's race empty when it is not in the list", () => {
      const [p] = checkProposals(
        answer({ newCharacters: [{ name: "Brin", fields: { race: "Dragonkin", adventurer_rank: "Iron" }, background: "", reason: "" }] }),
        [hero],
        fantasy,
        [],
        picks,
      );
      expect((p as NewCharacterProposal).values).toMatchObject({ race: "", adventurer_rank: "Iron" });
    });
  });

  it("never empties a field the main character must have (CR-03)", () => {
    const withAbility = { ...main, values: { ...main.values, name: "Lin Feng", special_ability: "Sees qi." } };
    expect(checkProposals(answer({ changes: [change("Lin Feng", "special_ability", "")] }), [withAbility], cultivation, ranks)).toEqual([]);
  });

  it("keeps a new character with its fields, unless the name is empty or already taken", () => {
    const proposals = checkProposals(
      answer({
        newCharacters: [
          { name: "Elder Wu", fields: { age: 70, status: "Alive", junk: 1 }, background: "Old.", reason: "Met." },
          { name: "", fields: {}, background: "", reason: "" },
          { name: "su mei", fields: {}, background: "", reason: "" },
        ],
      }),
      [main, mei],
      cultivation,
      ranks,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "new", name: "Elder Wu", background: "Old.", status: "pending" });
    expect((proposals[0] as NewCharacterProposal).values).toMatchObject({ name: "Elder Wu", age: 70 });
    expect((proposals[0] as NewCharacterProposal).values.junk).toBeUndefined();
    expect((proposals[0] as NewCharacterProposal).ageFilled).toBeUndefined();
  });

  it("fills in the type's default age when the AI gave none or one below the minimum (decision 67)", () => {
    const romance = getStoryType("romance");
    const proposals = checkProposals(
      answer({
        newCharacters: [
          { name: "Ava", fields: {}, background: "", reason: "" },
          { name: "Ben", fields: { age: 16 }, background: "", reason: "" },
          { name: "Cleo", fields: { age: "thirty" }, background: "", reason: "" },
          { name: "Dan", fields: { age: 40 }, background: "", reason: "" },
        ],
      }),
      [],
      romance,
      [],
    ) as NewCharacterProposal[];
    expect(proposals.map((p) => [p.name, p.values.age, p.ageFilled])).toEqual([
      ["Ava", 25, "missing"],
      ["Ben", 25, "too-low"],
      ["Cleo", 25, "missing"],
      ["Dan", 40, undefined],
    ]);
    // Cultivation has no minimum: a young age stays, a missing one is filled.
    const [young, none] = checkProposals(
      answer({ newCharacters: [{ name: "Xiao", fields: { age: 12 }, background: "", reason: "" }, { name: "Wu", fields: {}, background: "", reason: "" }] }),
      [],
      cultivation,
      ranks,
    ) as NewCharacterProposal[];
    expect([young.values.age, young.ageFilled]).toEqual([12, undefined]);
    expect([none.values.age, none.ageFilled]).toEqual([20, "missing"]);
  });
});

describe("formatValue and reviewDone", () => {
  it("shows values in plain words", () => {
    expect(formatValue("")).toBe("(empty)");
    expect(formatValue(null)).toBe("(empty)");
    expect(formatValue([])).toBe("(empty)");
    expect(formatValue(["a", "b"])).toBe("a, b");
    expect(formatValue(7)).toBe("7");
  });

  it("is done when nothing is pending", () => {
    expect(reviewDone({ chapter: 1, proposals: [] })).toBe(true);
  });
});

/** Writes `count` blocks with the default stub and returns the draft. */
async function writeBlocks(story: Story, count = 1) {
  let draft = await loadDraft(story);
  for (let i = 0; i < count; i++) draft = await writeBlock({ story, draft, direction: `Step ${i}` });
  return draft;
}

describe("End Chapter flow (spec 5.4, decision 50)", () => {
  it("saves the chapter, the summaries and the proposals, then the review lets the next chapter start", async () => {
    stubDefaultAi();
    let story = await readyStory();
    const draft = await writeBlocks(story, 2);

    const review = await endChapter(story, draft);
    story = await getStory(story.id);
    expect(story.chapterCount).toBe(1);
    expect(await readChapterText(story.id, 1)).toBe("Lin Feng climbed the stairs.\n\nLin Feng climbed the stairs.");
    expect(await readChapterSummary(story.id, 1)).toMatchObject({
      title: "The Gate",
      summary: "Lin Feng reached the gate and met Elder Wu.",
      openings: ["Lin Feng begins training at dawn", "A rival clan arrives at the gate"],
      // The stub sends no usage report, so the chapter's tokens are estimated (spec 6.6).
      tokens: { estimated: true },
    });
    expect(await readStorySummary(story.id)).toBe("Lin Feng left the clan and found a teacher.");
    expect(await readUsedScenes(story.id)).toEqual(["Leaving home at night", "Meeting a hidden teacher"]);
    expect(review.proposals.map((p) => p.kind)).toEqual(["change", "new"]);

    // The draft stays (and the setting stays locked) until the review is finished.
    expect(await store.exists(draftPath(story.id))).toBe(true);
    const state = await loadNovelState(story);
    expect(state.kind).toBe("review");
    await expect(finishChapter(story, 1)).rejects.toThrow("Approve or reject every proposed change first.");

    await approveProposal(story, 1, "change-1");
    const lin = (await listCharacters(story)).characters.find((c) => c.isMain)!;
    expect(lin.values.condition).toBe("Wounded");
    await rejectProposal(story.id, 1, "new-2");
    expect(reviewDone(await loadReview(story.id, 1))).toBe(true);

    await finishChapter(story, 1);
    expect(await store.exists(draftPath(story.id))).toBe(false);
    expect(await store.readText(`${chapterDir(story.id, 1)}/snapshot/characters/${lin.id}.md`)).toContain(
      "condition: Wounded",
    );
    const next = await loadNovelState(story);
    expect(next).toEqual({ kind: "writing", draft: { chapter: 2, blocks: [] } });
    expect((await listCharacters(story)).characters.map((c) => c.values.name)).toEqual(["Lin Feng"]);
  });

  it("sends chapter 1's summary, the story so far and its end to chapter 2 (spec 6.1)", async () => {
    const fetch = stubDefaultAi();
    let story = await readyStory();
    await endChapter(story, await writeBlocks(story));
    await rejectProposal(story.id, 1, "change-1");
    await rejectProposal(story.id, 1, "new-2");
    story = await finishChapter(story, 1);

    await writeBlocks(story);
    const user = sentMessages(fetch, fetch.mock.calls.length - 1)[1].content;
    expect(user).toContain("## The story so far\nLin Feng left the clan and found a teacher.");
    expect(user).toContain('Chapter 1, "The Gate": Lin Feng reached the gate and met Elder Wu.');
    expect(user).toContain("## End of the previous chapter\n…Lin Feng climbed the stairs.");
    expect(user).toContain("## Chapter 2 so far");
    expect(user).toContain("## Scenes already used\n");
    expect(user).toContain("- Leaving home at night\n- Meeting a hidden teacher");
  });

  it("keeps the old used scenes list when the answer has none (spec 6.4)", async () => {
    const { scenes: _, ...withoutScenes } = END_CHAPTER;
    stubAi((kind) => (kind === "end-chapter" ? JSON.stringify(withoutScenes) : BLOCK));
    const story = await readyStory();
    await saveUsedScenes(story.id, ["An old duel"]);
    await endChapter(story, await writeBlocks(story));
    expect(await readUsedScenes(story.id)).toEqual(["An old duel"]);
  });

  it("a romance new character without an age can be accepted as it is (decision 67)", async () => {
    stubAi((kind) =>
      kind === "end-chapter"
        ? JSON.stringify({ ...END_CHAPTER, character_changes: [], new_characters: [{ name: "Theo", fields: {}, background: "", reason: "" }] })
        : BLOCK,
    );
    const story = await readyStory({}, "romance");
    await endChapter(story, await writeBlocks(story));
    await approveProposal(story, 1, "new-1");
    const theo = (await listCharacters(story)).characters.find((c) => c.values.name === "Theo");
    expect(theo?.values.age).toBe(25);
  });

  it("keeps the chapter when the summary call fails, blocks the next chapter, and retries (spec 5.4)", async () => {
    let fail = true;
    stubAi((kind) => (kind === "end-chapter" ? (fail ? 500 : JSON.stringify(END_CHAPTER)) : BLOCK));
    const story = await readyStory();
    const draft = await writeBlocks(story);

    await expect(endChapter(story, draft)).rejects.toThrow(/server error \(500\)/);
    expect(await chapterEnded(story.id, 1)).toBe(true);
    const updated = await getStory(story.id);
    expect(await loadNovelState(updated)).toMatchObject({ kind: "summary-pending" });
    await expect(finishChapter(updated, 1)).rejects.toThrow("This chapter has no summary yet");
    // The ended chapter cannot get more blocks or new versions.
    await expect(writeBlock({ story: updated, draft, direction: "more" })).rejects.toThrow(
      "Chapter 1 has ended and can no longer be changed.",
    );
    await expect(writeBlock({ story: updated, draft, regenerate: { hint: "" } })).rejects.toThrow("has ended");

    fail = false;
    await summarizeChapter(updated, 1);
    expect(await loadNovelState(updated)).toMatchObject({ kind: "review" });
    expect(await readChapterText(story.id, 1)).toBe("Lin Feng climbed the stairs.");
  });

  /** Makes the first story.json write after chapter.md fail, as a file locked by antivirus would. */
  function failStoryJsonAfterChapter() {
    const real = store.writeText.bind(store);
    let armed = false;
    return vi.spyOn(store, "writeText").mockImplementation(async (p: string, c: string) => {
      if (p.endsWith("chapter.md")) armed = true;
      else if (armed && p.endsWith("story.json")) {
        armed = false;
        throw new Error("EPERM: operation not permitted");
      }
      return real(p, c);
    });
  }

  async function answerAll(storyId: string, n: number) {
    for (const p of (await loadReview(storyId, n)).proposals) await rejectProposal(storyId, n, p.id);
  }

  it("a failed story.json write after chapter.md is repaired on load, and the next chapter starts (decision 75)", async () => {
    stubDefaultAi();
    const story = await readyStory();
    const draft = await writeBlocks(story);
    const spy = failStoryJsonAfterChapter();
    await expect(endChapter(story, draft)).rejects.toThrow(/EPERM/);
    spy.mockRestore();

    const stale = await getStory(story.id);
    expect(stale.chapterCount).toBe(0);
    const fresh = await reconcileStory(stale);
    expect(fresh.chapterCount).toBe(1);
    expect((await getStory(story.id)).chapterCount).toBe(1);
    expect(await reconcileStory(fresh)).toBe(fresh); // nothing left to repair

    await summarizeChapter(fresh, 1);
    await answerAll(story.id, 1);
    const next = await finishChapter(fresh, 1);
    expect(await loadNovelState(next)).toEqual({ kind: "writing", draft: { chapter: 2, blocks: [] } });
  });

  it("keeps an accepted death through a failed story.json write, even without a reload (decision 75)", async () => {
    stubAi((kind) =>
      kind === "end-chapter"
        ? JSON.stringify({ ...END_CHAPTER, character_changes: [], new_characters: [] })
        : BLOCK.replace("DIED: no", "DIED: yes"),
    );
    const story = await readyStory();
    const draft = await writeBlocks(story);
    const spy = failStoryJsonAfterChapter();
    await expect(endChapter(story, draft, "death")).rejects.toThrow(/EPERM/);
    spy.mockRestore();
    expect((await loadDraft(story)).ending).toBe("death");

    // Retry with the story as the page still holds it; finishing repairs story.json before the draft goes.
    await summarizeChapter(story, 1);
    const next = await finishChapter(story, 1);
    expect(next).toMatchObject({ chapterCount: 1, ending: "death" });
    expect(await loadNovelState(next)).toEqual({ kind: "writing", draft: { chapter: 2, blocks: [], epilogue: true } });
  });

  it("clears a stale ending from the draft when the chapter is then ended without one", async () => {
    stubAi((kind) =>
      kind === "end-chapter" ? JSON.stringify({ ...END_CHAPTER, character_changes: [], new_characters: [] }) : BLOCK,
    );
    const story = await readyStory();
    const draft = await writeBlocks(story);
    const real = store.writeText.bind(store);
    const spy = vi.spyOn(store, "writeText").mockImplementation(async (p: string, c: string) => {
      if (p.endsWith("chapter.md")) throw new Error("ENOSPC: no space left on device");
      return real(p, c);
    });
    await expect(endChapter(story, draft, "death")).rejects.toThrow(/ENOSPC/);
    spy.mockRestore();
    expect(await chapterEnded(story.id, 1)).toBe(false);

    // The user regenerated the death away and ends the chapter normally.
    await endChapter(story, await loadDraft(story));
    expect((await loadDraft(story)).ending).toBeUndefined();
    const next = await finishChapter(story, 1);
    expect(next.ending).toBeUndefined();
  });

  it("a failed write after the AI answers leaves the chapter summary pending, and Retry saves it all (spec 5.4, decision 76)", async () => {
    stubDefaultAi();
    const story = await readyStory();
    const draft = await writeBlocks(story);
    const real = store.writeText.bind(store);
    let failed = false;
    const spy = vi.spyOn(store, "writeText").mockImplementation(async (p: string, c: string) => {
      // The story's "story so far", written after review.json and the used scenes.
      if (!failed && p === `stories/${story.id}/summary.md`) {
        failed = true;
        throw new Error("ENOSPC: no space left on device");
      }
      return real(p, c);
    });
    await expect(endChapter(story, draft)).rejects.toThrow(/ENOSPC/);
    spy.mockRestore();

    // The chapter's summary.md, the step's marker, was not written, so the review does not open empty.
    expect(await readChapterSummary(story.id, 1)).toBeNull();
    const updated = await getStory(story.id);
    expect(await loadNovelState(updated)).toMatchObject({ kind: "summary-pending" });
    await expect(finishChapter(updated, 1)).rejects.toThrow("This chapter has no summary yet");

    await summarizeChapter(updated, 1);
    expect(await readStorySummary(story.id)).toBe("Lin Feng left the clan and found a teacher.");
    const state = await loadNovelState(updated);
    expect(state.kind).toBe("review");
    if (state.kind === "review") expect(state.review.proposals.map((p) => p.status)).toEqual(["pending", "pending"]);
  });

  it("runs one End Chapter call per story at a time; a second one is refused (spec 5.4, decision 77)", async () => {
    const inner = stubDefaultAi();
    const story = await readyStory();
    const draft = await writeBlocks(story);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      await gate;
      return inner(url, init);
    });

    const first = endChapter(story, draft);
    await vi.waitFor(() => expect(summaryInFlight(story.id)).toBeDefined());
    const updated = await getStory(story.id);
    expect(await loadNovelState(updated)).toMatchObject({ kind: "summary-pending" });
    await expect(summarizeChapter(updated, 1)).rejects.toThrow(
      "The chapter summary is already being written. Wait for it to finish.",
    );

    release();
    await first;
    expect(summaryInFlight(story.id)).toBeUndefined();
    expect((await loadReview(story.id, 1)).proposals.map((p) => p.id)).toEqual(["change-1", "new-2"]);
    const editorCalls = inner.mock.calls.filter((_, i) => sentMessages(inner, i)[0].content.startsWith("You are the editor"));
    expect(editorCalls).toHaveLength(1);
  });

  it("stopping the End Chapter call (leaving the story) keeps the chapter, and Retry works (spec 5.4, decision 77)", async () => {
    const inner = stubDefaultAi();
    const story = await readyStory();
    const draft = await writeBlocks(story);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      await gate;
      return inner(url, init);
    });

    const controller = new AbortController();
    const first = endChapter(story, draft, undefined, controller.signal);
    await vi.waitFor(() => expect(summaryInFlight(story.id)).toBeDefined());
    controller.abort();
    release();
    await expect(first).rejects.toBeInstanceOf(AiStopped);
    expect(summaryInFlight(story.id)).toBeUndefined();

    const updated = await getStory(story.id);
    expect(await chapterEnded(story.id, 1)).toBe(true);
    expect(await loadNovelState(updated)).toMatchObject({ kind: "summary-pending" });
    await summarizeChapter(updated, 1);
    expect(await loadNovelState(updated)).toMatchObject({ kind: "review" });
  });

  it("does not end an empty chapter or an epilogue", async () => {
    const story = await readyStory();
    await expect(endChapter(story, { chapter: 1, blocks: [] })).rejects.toThrow("This chapter has no blocks yet.");
    await expect(endChapter(story, { chapter: 1, blocks: [], epilogue: true })).rejects.toThrow("accepted, not ended");
  });

  it("accepts a valid new character as it is, and asks for edits first when it fails the form's checks", async () => {
    stubAi((kind) =>
      kind === "end-chapter"
        ? JSON.stringify({ ...END_CHAPTER, new_characters: [{ name: "Elder Wu", fields: { cultivation_rank: "God" }, background: "", reason: "" }] })
        : BLOCK,
    );
    const story = await readyStory();
    await endChapter(story, await writeBlocks(story));
    const review = await loadReview(story.id, 1);
    const proposal = review.proposals.find((p) => p.kind === "new")!;
    await expect(approveProposal(story, 1, proposal.id)).rejects.toThrow(/^Edit Elder Wu first: This rank is not in the story's rank ladder/);

    // Saved from the form after editing: counts as accepted.
    await markAccepted(story.id, 1, proposal.id);
    expect((await loadReview(story.id, 1)).proposals.find((p) => p.id === proposal.id)?.status).toBe("approved");
  });

  it("saves an accepted new character", async () => {
    stubDefaultAi();
    const story = await readyStory();
    await endChapter(story, await writeBlocks(story));
    await approveProposal(story, 1, "new-2");
    const wu = (await listCharacters(story)).characters.find((c) => c.values.name === "Elder Wu");
    expect(wu).toMatchObject({ isMain: false, background: "An old teacher." });
    expect(wu?.values.age).toBe(70);
  });

  it("approving an answered proposal changes nothing (spec 7.5, decision 78)", async () => {
    stubDefaultAi();
    const story = await readyStory();
    await endChapter(story, await writeBlocks(story));
    await approveProposal(story, 1, "new-2");
    await rejectProposal(story.id, 1, "change-1");
    const before = (await listCharacters(story)).characters;

    const review = await approveProposal(story, 1, "new-2");
    await approveProposal(story, 1, "change-1");
    expect(review.proposals.map((p) => p.status)).toEqual(["rejected", "approved"]);
    expect((await listCharacters(story)).characters).toEqual(before);
    expect((await loadReview(story.id, 1)).proposals.map((p) => p.status)).toEqual(["rejected", "approved"]);
  });

  it("refuses to accept a new character whose name now exists, after a failed review.json write (spec 7.5, decision 78)", async () => {
    stubDefaultAi();
    const story = await readyStory();
    await endChapter(story, await writeBlocks(story));
    const real = store.writeText.bind(store);
    const spy = vi.spyOn(store, "writeText").mockImplementation(async (p: string, c: string) => {
      if (p.endsWith("review.json")) throw new Error("EPERM: operation not permitted");
      return real(p, c);
    });
    await expect(approveProposal(story, 1, "new-2")).rejects.toThrow(/EPERM/);
    spy.mockRestore();
    // The character was saved but the card is still pending; a second Accept must not add another.
    expect((await loadReview(story.id, 1)).proposals.find((p) => p.id === "new-2")?.status).toBe("pending");

    await expect(approveProposal(story, 1, "new-2")).rejects.toThrow(
      "A character called Elder Wu already exists, so this one was not added. Reject the proposal.",
    );
    const names = (await listCharacters(story)).characters.map((c) => c.values.name);
    expect(names.filter((n) => n === "Elder Wu")).toHaveLength(1);
    await rejectProposal(story.id, 1, "new-2");
    expect(names).toContain("Elder Wu");
  });

  it("explains a proposal that no longer exists, or a character whose file is gone", async () => {
    stubDefaultAi();
    const story = await readyStory();
    await endChapter(story, await writeBlocks(story));
    await expect(approveProposal(story, 1, "nope")).rejects.toThrow("That proposal no longer exists.");
    await expect(rejectProposal(story.id, 1, "nope")).rejects.toThrow("That proposal no longer exists.");
    for (const entry of await store.list(`stories/${story.id}/characters`)) {
      await store.remove(`stories/${story.id}/characters/${entry.name}`);
    }
    await expect(approveProposal(story, 1, "change-1")).rejects.toThrow("Lin Feng no longer has a character file");
  });
});

describe("the story's ending (spec 5.5, decision 52)", () => {
  it("refuses to accept a death when Main character death is Never (decision 62)", async () => {
    stubAi(() => BLOCK.replace("DIED: no", "DIED: yes"));
    let story = await readyStory();
    const doc = await loadSetting(story);
    story = await saveSetting(story, { ...doc, values: { ...doc.values, main_character_death: "Never" } });
    const draft = await writeBlocks(story);
    await expect(endChapter(story, draft, "death")).rejects.toThrow("set to Never, so the death cannot be accepted");
    expect(await chapterEnded(story.id, 1)).toBe(false);
    expect((await getStory(story.id)).ending).toBeUndefined();
  });

  it("an accepted death ends the chapter, then the epilogue completes the story", async () => {
    const fetch = stubAi((kind) =>
      kind === "end-chapter"
        ? JSON.stringify({ ...END_CHAPTER, character_changes: [], new_characters: [] })
        : kind === "epilogue"
          ? "Years later, the bell still rang."
          : BLOCK.replace("DIED: no", "DIED: yes"),
    );
    let story = await readyStory();
    const draft = await writeBlocks(story);

    await endChapter(story, draft, "death");
    story = await getStory(story.id);
    expect(story.ending).toBe("death");
    story = await finishChapter(story, 1);

    // After the chapter, the next draft is the epilogue.
    const state = await loadNovelState(story);
    expect(state).toEqual({ kind: "writing", draft: { chapter: 2, blocks: [], epilogue: true } });
    if (state.kind !== "writing") return;
    let epilogue = await writeBlock({ story, draft: state.draft, direction: "Show the funeral" });
    const system = sentMessages(fetch, fetch.mock.calls.length - 1)[0].content;
    expect(system).toContain("Write the epilogue");
    expect(system).toContain("died at the end of the last chapter");
    expect(epilogue.blocks[0].versions[0]).toMatchObject({ text: "Years later, the bell still rang.", actions: [], died: false });

    // It can be regenerated until accepted.
    epilogue = await writeBlock({ story, draft: epilogue, regenerate: { hint: "shorter" } });
    expect(epilogue.blocks[0].versions).toHaveLength(2);
    await expect(writeBlock({ story, draft: epilogue, direction: "more" })).rejects.toThrow("The epilogue is written.");

    story = await acceptEpilogue(story, epilogue);
    expect(story.status).toBe("completed");
    expect(story.chapterCount).toBe(2);
    expect(await listChapters(story.id)).toEqual([
      { number: 1, title: "The Gate", hasSummary: true },
      { number: 2, title: "Epilogue", hasSummary: true },
    ]);
    expect(await store.exists(`${chapterDir(story.id, 2)}/snapshot/setting.md`)).toBe(true);
    expect(await store.exists(draftPath(story.id))).toBe(false);
    expect(await loadNovelState(story)).toEqual({ kind: "completed" });
  });

  it("End story leads to an epilogue without a death, only between chapters", async () => {
    const fetch = stubDefaultAi();
    let story = await readyStory();
    const draft = await writeBlocks(story);
    await expect(endStory(story, draft)).rejects.toThrow("Finish the current chapter first.");

    story = await endStory(story, { chapter: 1, blocks: [] });
    expect(story.ending).toBe("choice");
    expect((await loadDraft(story)).epilogue).toBeUndefined(); // the chapter's draft file is still there
    await store.remove(draftPath(story.id));
    const epilogueDraft = await loadDraft(story);
    expect(epilogueDraft.epilogue).toBe(true);
    await writeBlock({ story, draft: epilogueDraft, direction: "" });
    const system = sentMessages(fetch, fetch.mock.calls.length - 1)[0].content;
    expect(system).toContain("Bring the story to its close");
  });

  it("refuses to accept an epilogue that is not written", async () => {
    const story = await readyStory();
    await expect(acceptEpilogue(story, { chapter: 1, blocks: [], epilogue: true })).rejects.toThrow(
      "There is no epilogue to accept yet.",
    );
  });
});

describe("tokens of a chapter (spec 6.6, decision 87)", () => {
  /** The default answers, each with the given usage report. */
  function stubWithUsage(prompt: number, completion: number) {
    const fn = vi.fn(async (_url: string, init: RequestInit) => {
      const { messages } = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const text = system.startsWith("You are the editor")
        ? JSON.stringify(END_CHAPTER)
        : system.includes("Write the epilogue")
          ? "Years later."
          : BLOCK;
      const usage = { prompt_tokens: prompt, completion_tokens: completion };
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`;
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fn);
  }

  it("saves the blocks, a regenerated version and the End Chapter call as the chapter's total", async () => {
    const story = await readyStory();
    stubWithUsage(1200, 300);
    let draft = await writeBlocks(story, 2);
    draft = await writeBlock({ story, draft, regenerate: { hint: "" } });
    await endChapter(story, draft);
    expect((await readChapterSummary(story.id, 1))?.tokens).toEqual({ input: 4800, output: 1200 });
  });

  it("keeps the tokens when the title is renamed", async () => {
    const story = await readyStory();
    stubWithUsage(10, 1);
    await endChapter(story, await writeBlocks(story, 1));
    const { renameChapter } = await import("./chapters");
    await renameChapter(story.id, 1, "New title");
    expect(await readChapterSummary(story.id, 1)).toMatchObject({ title: "New title", tokens: { input: 20, output: 2 } });
  });

  it("does not count a failed End Chapter call, only the one that succeeded", async () => {
    let story = await readyStory();
    stubWithUsage(100, 10);
    const draft = await writeBlocks(story, 1);
    stubAi((kind) => (kind === "end-chapter" ? 500 : BLOCK));
    await expect(endChapter(story, draft)).rejects.toThrow();
    stubWithUsage(100, 10);
    story = await getStory(story.id);
    await summarizeChapter(story, 1);
    expect((await readChapterSummary(story.id, 1))?.tokens).toEqual({ input: 200, output: 20 });
  });

  it("saves the epilogue's own total when it is accepted", async () => {
    let story = await readyStory();
    stubWithUsage(50, 5);
    story = await endStory(story, await loadDraft(story));
    let draft = await writeBlock({ story, draft: await loadDraft(story), direction: "" });
    draft = await writeBlock({ story, draft, regenerate: { hint: "" } });
    story = await acceptEpilogue(story, draft);
    expect((await readChapterSummary(story.id, 1))?.tokens).toEqual({ input: 100, output: 10 });
  });
});

describe("choice values in the novel's language (spec 6.5, decision 84)", () => {
  const hant = "繁體中文 (Traditional Chinese)";
  const main: Character = { ...newCharacter(cultivation, true), id: "lin" };

  it("lists the allowed values and sends the characters' choices in the novel's language", () => {
    const [, user] = buildEndChapterPrompt({
      type: cultivation,
      language: hant,
      chapter: 1,
      chapterText: "鐘響了。",
      storySummary: "",
      characters: [main],
      storySummaryTokens: 1000,
      usedScenes: [],
      usedScenesTokens: 300,
    });
    expect(user.content).toContain("- status: one of 在世, 已故, 暫不出場");
    expect(user.content).toContain("gender: 男");
    expect(user.content).toContain("spiritual_root: 雷");
    expect(user.content).not.toContain("gender: Male");
  });

  it("reads Chinese values in proposals back to the saved English ones, and still accepts English", () => {
    const answer: EndChapterAnswer = {
      title: "",
      chapterSummary: "a",
      storySummary: "b",
      scenes: [],
      nextOpenings: [],
      picture: "",
      changes: [
        { character: "Lin Feng", field: "spiritual_root", newValue: "冰", reason: "r" },
        { character: "Lin Feng", field: "status", newValue: "Inactive", reason: "r" },
      ],
      newCharacters: [{ name: "吳長老", fields: { gender: "男", status: "在世", age: 70 }, background: "", reason: "" }],
    };
    const proposals = checkProposals(answer, [main], cultivation, []);
    expect(proposals.map((p) => (p.kind === "change" ? p.newValue : p.values.gender))).toEqual(["Ice", "Inactive", "Male"]);
    expect(proposals[2].kind === "new" && proposals[2].values.status).toBe("Alive");
  });
});

describe("ranks in the End Chapter call (spec 6.5, CR6-02)", () => {
  it("lists the setting's own ranks, in the story's language, with no English example", () => {
    const [, user] = buildEndChapterPrompt({
      type: cultivation,
      language: "繁體中文 (Traditional Chinese)",
      chapter: 1,
      chapterText: "鐘響了。",
      storySummary: "",
      characters: [{ ...newCharacter(cultivation, true), id: "lin" }],
      storySummaryTokens: 1000,
      usedScenes: [],
      usedScenesTokens: 300,
      ranks: ["凡人", "煉氣, 初期", "煉氣, 中期"],
    });
    expect(user.content).toContain("- cultivation_rank: one of the ranks in the setting's rank ladder: 凡人 | 煉氣, 初期 | 煉氣, 中期");
    // The field line gives no English example any more (the fixture's main character still has an English rank).
    expect(user.content).not.toContain('e.g. "Qi Refining, Early"');
  });
});
