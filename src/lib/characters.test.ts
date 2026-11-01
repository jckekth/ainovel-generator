import { describe, expect, it } from "vitest";
import { getSet, setMainCharacter } from "./curatedSets";
import {
  Character,
  characterName,
  deleteCharacter,
  getReadiness,
  hasAppeared,
  hiddenKeys,
  listCharacters,
  newCharacter,
  requiredKeys,
  saveCharacter, exampleMainCharacter } from "./characters";
import { parseMarkDoc } from "./markdoc";
import { loadSetting, saveSetting } from "./setting";
import { store } from "./storage";
import { createStory, Story, storyDir } from "./stories";
import { characterFields, getStoryType } from "./storyTypes";

const newStory = (type = "cultivation") => createStory({ title: "Test", type, language: "English" });

function make(story: Story, name: string, isMain = false, values: Record<string, unknown> = {}): Character {
  const c = newCharacter(getStoryType(story.type), isMain);
  c.values = { ...c.values, name, ...values };
  return c;
}

const fileOf = (story: Story, c: Character) => `${storyDir(story.id)}/characters/${c.id}.md`;

describe("rules from the story type", () => {
  it("requires the special ability for a cultivation main character only (spec 7.3)", () => {
    const type = getStoryType("cultivation");
    const fields = characterFields(type);
    expect(requiredKeys(type, fields, true).has("special_ability")).toBe(true);
    expect(requiredKeys(type, fields, false).has("special_ability")).toBe(false);
    expect(requiredKeys(type, fields, true).has("name")).toBe(true);
  });

  it("requires an age in romance stories (decision 16)", () => {
    const type = getStoryType("romance");
    expect(requiredKeys(type, characterFields(type), false).has("age")).toBe(true);
  });

  it("hides relationship fields for the main character only", () => {
    const fields = characterFields(getStoryType("romance"));
    expect([...hiddenKeys(fields, true)].sort()).toEqual(["affection", "relationship", "relationship_stage"]);
    expect(hiddenKeys(fields, false).size).toBe(0);
  });

  it("names an unnamed character", () => {
    expect(characterName(newCharacter(getStoryType("romance"), false))).toBe("Unnamed character");
  });
});

describe("new characters (decisions 45, 85)", () => {
  it("starts a main character as the type's first set in English when no example is given", () => {
    const type = getStoryType("cultivation");
    const main = newCharacter(type, true);
    expect(main.values.name).toBe("Lin Feng");
    expect(main.values.special_ability).toBeTruthy();
    expect(main.background).toBe(setMainCharacter(getSet("cultivation")!, "English").background);
    expect(newCharacter(getStoryType("romance"), true).values).toMatchObject({ name: "Chen Mei", age: 27 });
  });

  it("starts other characters empty", () => {
    const other = newCharacter(getStoryType("cultivation"), false);
    expect(other.values.name).toBe("");
    expect(other.background).toBe("");
  });

  it("does not let edits to a new character change the example", () => {
    const type = getStoryType("cultivation");
    (newCharacter(type, true).values.techniques as string[]).push("Stolen technique");
    expect(newCharacter(type, true).values.techniques).not.toContain("Stolen technique");
  });
});

describe("saving characters", () => {
  it("gives the character an id from its name and writes main_character after name", async () => {
    const story = await newStory();
    const saved = await saveCharacter(story, make(story, "Lin Feng", true, { special_ability: "Reads qi" }));
    expect(saved.id).toMatch(/^lin-feng-[a-z0-9]{6}$/);
    const raw = await store.readText(fileOf(story, saved));
    expect(raw.startsWith("---\nname: Lin Feng\nmain_character: true\n")).toBe(true);
  });

  it("leaves out fields hidden for the main character", async () => {
    const story = await newStory("romance");
    const saved = await saveCharacter(story, make(story, "Mei", true, { age: 25 }));
    const { header } = parseMarkDoc(await store.readText(fileOf(story, saved)));
    expect(header).not.toHaveProperty("relationship");
    expect(header).not.toHaveProperty("affection");
    expect(header.age).toBe(25);
  });

  it("refuses a second main character, but saves the existing one again (spec 7.1)", async () => {
    const story = await newStory();
    const main = await saveCharacter(story, make(story, "Lin Feng", true));
    await expect(saveCharacter(story, make(story, "Usurper", true))).rejects.toThrow(/already has a main character/);
    main.values.speech_style = "Curt";
    await expect(saveCharacter(story, main)).resolves.toMatchObject({ id: main.id });
  });

  it("keeps the id and unknown keys when saved again", async () => {
    const story = await newStory();
    const saved = await saveCharacter(story, make(story, "Elder Zhao"));
    await store.writeText(fileOf(story, saved), (await store.readText(fileOf(story, saved))).replace("---\nname:", "---\nnickname: Old Fox\nname:"));
    const [reread] = (await listCharacters(story)).characters;
    expect(reread.extra).toEqual({ nickname: "Old Fox" });
    await saveCharacter(story, reread);
    expect((await listCharacters(story)).characters).toHaveLength(1);
    expect(parseMarkDoc(await store.readText(fileOf(story, saved))).header.nickname).toBe("Old Fox");
  });
});

describe("listing characters", () => {
  it("puts the main character first, then sorts by name", async () => {
    const story = await newStory();
    await saveCharacter(story, make(story, "Zhao"));
    await saveCharacter(story, make(story, "Lin Feng", true));
    await saveCharacter(story, make(story, "Bai"));
    const { characters } = await listCharacters(story);
    expect(characters.map(characterName)).toEqual(["Lin Feng", "Bai", "Zhao"]);
    expect(characters[0].isMain).toBe(true);
  });

  it("reports an unreadable file instead of failing, and skips non-markdown files", async () => {
    const story = await newStory();
    await saveCharacter(story, make(story, "Bai"));
    await store.writeText(`${storyDir(story.id)}/characters/broken.md`, "---\nname: [oops\n---\n");
    await store.writeText(`${storyDir(story.id)}/characters/notes.txt`, "ignore me");
    const list = await listCharacters(story);
    expect(list.characters.map(characterName)).toEqual(["Bai"]);
    expect(list.unreadable).toEqual([{ file: "broken.md", error: expect.stringMatching(/YAML header/) }]);
  });
});

describe("deleting characters (spec 7.1)", () => {
  const writeChapter = (story: Story, n: string, text: string) =>
    store.writeText(`${storyDir(story.id)}/chapters/${n}/chapter.md`, text);

  it("refuses to delete the main character", async () => {
    const story = await newStory();
    const main = await saveCharacter(story, make(story, "Lin Feng", true));
    await expect(deleteCharacter(story, main)).rejects.toThrow(/main character cannot be deleted/);
  });

  it("refuses to delete a character who appeared in a chapter (decision 32)", async () => {
    const story = await newStory();
    const bai = await saveCharacter(story, make(story, "Bai Xue"));
    await writeChapter(story, "001", "Nothing here.");
    await writeChapter(story, "002", "Bai Xue drew her sword.");
    expect(await hasAppeared(story.id, "Bai Xue")).toBe(true);
    await expect(deleteCharacter(story, bai)).rejects.toThrow(/Set its status to Dead or Inactive/);
    expect(await store.exists(fileOf(story, bai))).toBe(true);
  });

  it("deletes a character who has not appeared", async () => {
    const story = await newStory();
    const bai = await saveCharacter(story, make(story, "Bai Xue"));
    await writeChapter(story, "001", "Lin Feng walked alone.");
    expect(await hasAppeared(story.id, "Bai Xue")).toBe(false);
    await deleteCharacter(story, bai);
    expect(await store.exists(fileOf(story, bai))).toBe(false);
  });

  it("never matches an empty name", async () => {
    const story = await newStory();
    await writeChapter(story, "001", "Text");
    expect(await hasAppeared(story.id, "  ")).toBe(false);
  });
});

describe("readiness for the Novel page (spec 4)", () => {
  it("needs a saved setting and a main character", async () => {
    const story = await newStory();
    expect(await getReadiness(story.id)).toEqual({ hasSetting: false, hasMainCharacter: false });

    await saveCharacter(story, make(story, "Side character"));
    expect((await getReadiness(story.id)).hasMainCharacter).toBe(false);

    await saveSetting(story, await loadSetting(story));
    await saveCharacter(story, make(story, "Lin Feng", true));
    expect(await getReadiness(story.id)).toEqual({ hasSetting: true, hasMainCharacter: true });
  });
});

describe("the set's main character (spec 7.1, decision 85)", () => {
  it("comes from the story's set, in the story's language", async () => {
    const story = await createStory({ title: "T", type: "romance", language: "简体中文 (Simplified Chinese)", setId: "hillside-campus" });
    const example = exampleMainCharacter(story)!;
    expect(example.values).toMatchObject({ name: "江辰", gender: "Male", age: 20, occupation: "建筑系大三学生，兼职家教" });
    const main = newCharacter(getStoryType("romance"), true, example);
    expect(main.values.name).toBe("江辰");
    expect(main.background).toBe(example.background);
    expect(newCharacter(getStoryType("romance"), false, example).values.name).toBe("");
  });

  it("leaves out a race or rank the story's setting no longer lists (decision 104, QA-03)", async () => {
    const story = await createStory({ title: "T", type: "fantasy", language: "English", setId: "ash-and-iron" });
    expect(exampleMainCharacter(story)!.values).toMatchObject({ race: "Humans", adventurer_rank: "Sworn Blade" });
    const kept = exampleMainCharacter(story, { races: ["Humans: hard people"], adventurer_ranks: ["Unproven", "Sworn Blade"] })!;
    expect(kept.values).toMatchObject({ race: "Humans", adventurer_rank: "Sworn Blade" });
    const cleared = exampleMainCharacter(story, { races: ["Orcs: strong"], adventurer_ranks: [] })!;
    expect(cleared.values.race).toBeUndefined();
    expect(cleared.values.adventurer_rank).toBeUndefined();
    expect(newCharacter(getStoryType("fantasy"), true, cleared).values.adventurer_rank).toBe("");
  });
});
