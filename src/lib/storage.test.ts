import { describe, expect, it } from "vitest";
import { readJson, store, writeJson } from "./storage";

const names = async (path: string) => (await store.list(path)).map((e) => `${e.name}${e.isDirectory ? "/" : ""}`).sort();

describe("browser store (decision 26)", () => {
  it("has no data folder path", async () => {
    expect(await store.rootPath()).toBeNull();
  });

  it("reads back what it wrote", async () => {
    await store.writeText("stories/a/setting.md", "hello");
    expect(await store.readText("stories/a/setting.md")).toBe("hello");
  });

  it("throws for a missing file", async () => {
    await expect(store.readText("nope.txt")).rejects.toThrow("File not found: nope.txt");
  });

  it("knows files and folders exist, without matching a longer name", async () => {
    await store.writeText("stories/abc/story.json", "{}");
    expect(await store.exists("stories/abc/story.json")).toBe(true);
    expect(await store.exists("stories/abc")).toBe(true);
    expect(await store.exists("stories")).toBe(true);
    expect(await store.exists("stories/ab")).toBe(false);
  });

  it("lists direct children once each, with folders marked", async () => {
    await store.writeText("stories/a/story.json", "{}");
    await store.writeText("stories/a/characters/x.md", "");
    await store.writeText("stories/b/story.json", "{}");
    await store.writeText("app-settings.json", "{}");
    expect(await names("stories")).toEqual(["a/", "b/"]);
    expect(await names("stories/a")).toEqual(["characters/", "story.json"]);
    expect(await names("")).toEqual(["app-settings.json", "stories/"]);
    expect(await store.list("missing")).toEqual([]);
  });

  it("removes a folder with everything in it, but not a sibling with the same prefix", async () => {
    await store.writeText("stories/a/story.json", "{}");
    await store.writeText("stories/a/characters/x.md", "");
    await store.writeText("stories/ab/story.json", "{}");
    await store.remove("stories/a");
    expect(await store.exists("stories/a")).toBe(false);
    expect(await store.exists("stories/ab/story.json")).toBe(true);
  });

  it("leaves other localStorage keys alone", async () => {
    localStorage.setItem("unrelated", "1");
    await store.writeText("x.txt", "x");
    expect(await names("")).toEqual(["x.txt"]);
    await store.remove("x.txt");
    expect(localStorage.getItem("unrelated")).toBe("1");
  });

  it("round-trips JSON, pretty-printed", async () => {
    await writeJson("a.json", { b: [1, 2] });
    expect(await readJson("a.json")).toEqual({ b: [1, 2] });
    expect(await store.readText("a.json")).toContain("\n  ");
  });
});
