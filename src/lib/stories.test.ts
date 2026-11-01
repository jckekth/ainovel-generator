import { afterEach, describe, expect, it, vi } from "vitest";
import { store } from "./storage";
import { createStory, deleteStory, getStory, listStories, makeId, markOpened, storyDir, updateStory } from "./stories";

afterEach(() => {
  vi.useRealTimers();
});

describe("makeId", () => {
  it("makes a readable slug with a short random suffix", () => {
    expect(makeId("The Azure Sword!")).toMatch(/^the-azure-sword-[a-z0-9]{6}$/);
  });

  it("caps the slug at 32 characters", () => {
    const id = makeId("a".repeat(50));
    expect(id).toMatch(/^a{32}-[a-z0-9]{6}$/);
  });

  it("uses the fallback when the text has no Latin letters or digits", () => {
    expect(makeId("剑来")).toMatch(/^story-[a-z0-9]{6}$/);
    expect(makeId("", "character")).toMatch(/^character-[a-z0-9]{6}$/);
  });

  it("removes accents instead of dropping the letter", () => {
    expect(makeId("Café")).toMatch(/^cafe-/);
  });
});

describe("stories on disk", () => {
  const input = { title: "  My Story  ", type: "cultivation", language: "English" };

  it("creates story.json with a trimmed title and an active status", async () => {
    const story = await createStory(input);
    expect(story).toMatchObject({ title: "My Story", type: "cultivation", status: "active", chapterCount: 0 });
    expect(await store.exists(`${storyDir(story.id)}/story.json`)).toBe(true);
    expect(await getStory(story.id)).toEqual(story);
  });

  it("lists stories newest first and skips folders without a readable story.json", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const older = await createStory({ ...input, title: "Older" });
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const newer = await createStory({ ...input, title: "Newer" });
    await store.writeText("stories/broken/story.json", "{not json");
    await store.writeText("stories/empty/notes.md", "- a");
    await store.writeText("stories/loose-file.txt", "x");

    expect((await listStories()).map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it("puts the most recently opened story first, a new one counting as opened (decision 109)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const first = await createStory({ ...input, title: "First" });
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const second = await createStory({ ...input, title: "Second" });
    expect(second.openedAt).toBe("2026-02-01T00:00:00.000Z");
    // A change to the second story does not move it ahead of a story opened later.
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const opened = await markOpened(first.id);
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));
    await updateStory(second.id, { chapterCount: 1 });
    expect((await listStories()).map((s) => s.id)).toEqual([first.id, second.id]);
    expect(opened.updatedAt).toBe(first.updatedAt);
  });

  it("orders a story from before phase 7, with no opened time, by its last change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const old = await createStory({ ...input, title: "Old" });
    const { openedAt: _, ...withoutOpened } = old;
    await store.writeText(`${storyDir(old.id)}/story.json`, JSON.stringify({ ...withoutOpened, updatedAt: "2026-05-01T00:00:00.000Z" }));
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const newer = await createStory({ ...input, title: "Newer" });
    expect((await listStories()).map((s) => s.id)).toEqual([old.id, newer.id]);
  });

  it("gives an empty list when there are no stories", async () => {
    expect(await listStories()).toEqual([]);
  });

  it("updates a story, keeps its id and bumps updatedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const story = await createStory(input);
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const updated = await updateStory(story.id, { chapterCount: 2 });
    expect(updated.id).toBe(story.id);
    expect(updated.chapterCount).toBe(2);
    expect(updated.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(updated.createdAt).toBe(story.createdAt);
    expect(await getStory(story.id)).toEqual(updated);
  });

  it("deletes the whole story folder", async () => {
    const story = await createStory(input);
    await store.writeText(`${storyDir(story.id)}/characters/a.md`, "x");
    await deleteStory(story.id);
    expect(await store.exists(storyDir(story.id))).toBe(false);
    expect(await listStories()).toEqual([]);
  });
});

describe("curated set of a new story (decisions 72, 85)", () => {
  it("picks one of the type's sets at random, or keeps the one given", async () => {
    const { setsOf } = await import("./curatedSets");
    const ids = setsOf("romance").map((s) => s.id);
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add((await createStory({ title: "T", type: "romance", language: "English" })).setId!);
    for (const id of seen) expect(ids).toContain(id);
    expect(seen.size).toBeGreaterThan(1);
    expect((await createStory({ title: "T", type: "romance", language: "English", setId: "tower-office" })).setId).toBe("tower-office");
  });
});
