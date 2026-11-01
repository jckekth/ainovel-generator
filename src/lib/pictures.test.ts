import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PICTURE_SIZE } from "../images.config";
import { END_CHAPTER, readyStory } from "../test/fixtures";
import { AiError, generateImage, imageBody, PictureRefused } from "./ai";
import { parseBlock, stripFlagLines, visibleText } from "./block";
import { readChapterSummary } from "./chapters";
import { Character, listCharacters, newCharacter, saveCharacter } from "./characters";
import { aiLogDir, formatAiLog } from "./devlog";
import { BlockVersion, Draft, loadDraft } from "./draft";
import { buildEndChapterPrompt, endChapter, finishChapter, rejectProposal, approveProposal, loadReview } from "./endChapter";
import { writeBlock } from "./novel";
import {
  blockPicturePath,
  chapterPicturePath,
  costText,
  drawBlockPicture,
  keepChapterPictures,
  loadImageConfig,
  pictureCost,
  picturePrompt,
  pictureState,
  readChapterPictures,
  sceneFromText,
  SCENE_FROM_TEXT_CHARS,
} from "./pictures";
import { setApiKey, setImageKey } from "./secrets";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";
import { store } from "./storage";
import { Story } from "./stories";
import { getStoryType } from "./storyTypes";

/** A tiny PNG's first bytes are enough: the app stores what the provider sends. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_B64 = btoa(String.fromCharCode(...PNG));

const SCENE = "Lin Feng stands at the gate of the Azure Cloud Sect in the rain.";
const RICH_BLOCK = `Lin Feng climbed the stairs.\n\nThe rain fell.\n\n=== NEXT ===\nKnock | Bold\nTurn back\nMAIN CHARACTER DIED: no\nMOOD: none\nPICTURE: ${SCENE}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const stream = (text: string) =>
  new Response(
    (text.match(/[\s\S]{1,7}/g) ?? []).map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );

/**
 * Stubs fetch: chat completions answer with `chat` (or the End Chapter JSON), and
 * picture requests with `image` (a status number, or a picture).
 */
function stubAll({ chat = RICH_BLOCK, image = 200 as number | (() => Response) } = {}) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/images/generations")) {
      if (typeof image === "function") return image();
      return image === 200 ? json({ data: [{ b64_json: PNG_B64 }] }) : json({ error: { message: `status ${image}` } }, image);
    }
    const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    const system = body.messages[0].content;
    return stream(system.startsWith("You are the editor") ? JSON.stringify({ ...END_CHAPTER, picture: SCENE }) : chat);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const imageCalls = (fetch: ReturnType<typeof stubAll>) => fetch.mock.calls.filter(([url]) => url.endsWith("/images/generations"));

let story: Story;

beforeEach(async () => {
  story = await readyStory();
  await setImageKey("sk-image");
});

afterEach(() => vi.unstubAllGlobals());

async function useImages(images: "none" | "lite" | "rich", extra: Partial<typeof DEFAULT_SETTINGS> = {}) {
  await saveSettings({ ...(await loadSettings()), images, imageBaseUrl: "https://img.example.com/v1", ...extra });
}

describe("the picture line (spec 6.3, 14.2)", () => {
  it("is read after the marker, saved apart from the actions and never shown", () => {
    const block = parseBlock(RICH_BLOCK);
    expect(block.picture).toBe(SCENE);
    expect(block.actions).toEqual(["Knock", "Turn back"]);
    expect(block.text).toBe("Lin Feng climbed the stairs.\n\nThe rain fell.");
  });

  it("is read without the marker too, and kept out of the story", () => {
    const block = parseBlock(`Lin Feng waited.\n\n**PICTURE:** "${SCENE}"`);
    expect(block.picture).toBe(SCENE);
    expect(block.text).toBe("Lin Feng waited.");
    expect(stripFlagLines(`Lin Feng waited.\nPICTURE: ${SCENE}`)).toBe("Lin Feng waited.");
  });

  it("leaves no picture for an empty line or none at all", () => {
    expect(parseBlock("Text\n=== NEXT ===\nGo\nPICTURE:").picture).toBeUndefined();
    expect(parseBlock("Text\n=== NEXT ===\nGo").picture).toBeUndefined();
  });

  it("is held back while it streams in", () => {
    expect(visibleText("Lin Feng waited.\nPICT")).toBe("Lin Feng waited.");
  });
});

describe("Rich: writeBlock asks for a picture line only on Rich (spec 14.2)", () => {
  it("asks for it and saves the scene with the version on Rich", async () => {
    await useImages("rich");
    const fetch = stubAll();
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "Climb" });
    const system = JSON.parse(fetch.mock.calls[0][1]!.body as string).messages[0].content as string;
    expect(system).toContain("Then the picture line");
    expect(draft.blocks[0].versions[0].picture).toBe(SCENE);
    expect((await loadDraft(story)).blocks[0].versions[0].picture).toBe(SCENE);
  });

  it("asks for none, keeps none and sends no picture request on None", async () => {
    await useImages("none");
    const fetch = stubAll();
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "Climb" });
    const system = JSON.parse(fetch.mock.calls[0][1]!.body as string).messages[0].content as string;
    expect(system).not.toContain("PICTURE");
    expect(draft.blocks[0].versions[0].picture).toBeUndefined();
    expect(imageCalls(fetch)).toHaveLength(0);
  });
});

describe("picturePrompt (spec 14.2, decisions 143–145)", () => {
  const type = getStoryType("cultivation");
  const person = (name: string, appearance: string, isMain = false): Character => {
    const c = newCharacter(type, isMain);
    c.values = { ...c.values, name, appearance };
    return c;
  };

  it("joins the type's style, the scene and the looks of the characters the scene names", () => {
    const prompt = picturePrompt(type.imageStyle, "Lin Feng bows to Su Mei.", [
      person("Lin Feng", "Lean, black hair tied up", true),
      person("Su Mei", "Tall, silver hairpin"),
      person("Elder Wu", "White beard"),
    ]);
    expect(prompt).toContain(`Style: ${type.imageStyle}`);
    expect(prompt).toContain("Scene: Lin Feng bows to Su Mei.");
    expect(prompt).toContain("- Lin Feng: Lean, black hair tied up");
    expect(prompt).toContain("- Su Mei: Tall, silver hairpin");
    expect(prompt).not.toContain("Elder Wu");
    expect(prompt).toContain("No text");
  });

  it("leaves out characters without an appearance, and matches Chinese names", () => {
    const prompt = picturePrompt("ink", "林峰 stands alone.", [person("林峰", "身形精瘦"), person("Su Mei", "")]);
    expect(prompt).toContain("- 林峰: 身形精瘦");
    expect(picturePrompt("ink", "Su Mei waits.", [person("Su Mei", "")])).not.toContain("How the characters look");
  });

  it("every story type has a style", () => {
    for (const id of ["cultivation", "romance", "fantasy", "general"]) expect(getStoryType(id).imageStyle.length).toBeGreaterThan(20);
  });

  it("uses the end of a block's text when there is no scene line (spec 14.4)", () => {
    expect(sceneFromText("  Short.  ")).toBe("Short.");
    const long = "a".repeat(SCENE_FROM_TEXT_CHARS) + "THE END";
    expect(sceneFromText(long).endsWith("THE END")).toBe(true);
    expect(sceneFromText(long).length).toBe(SCENE_FROM_TEXT_CHARS + 1);
  });
});

describe("cost (spec 14.1, decision 142)", () => {
  it("gives the price per picture and per chapter for a known model", () => {
    expect(pictureCost("gpt-image-1-mini", "low")).toBe(0.006);
    expect(costText("gpt-image-1-mini", "low")).toBe(
      "About $0.006 per picture with gpt-image-1-mini at this quality. Lite: about $0.006 per chapter. Rich: about $0.036 to $0.048 per chapter.",
    );
  });

  it("says when the price is not known", () => {
    expect(pictureCost("dall-e-9", "low")).toBeNull();
    expect(costText("dall-e-9", "medium")).toMatch(/does not know the price of dall-e-9/);
  });
});

describe("settings for pictures (spec 9, 14.1)", () => {
  it("default to None with OpenAI's images and the mini model", async () => {
    const s = await loadSettings();
    expect(s.images).toBe("none");
    expect(s.imageModel).toBe("gpt-image-1-mini");
    expect(s.imageQuality).toBe("low");
    expect(s.imageSameAsText).toBe(false);
  });

  it("tidy unknown values from a hand-edited file", async () => {
    await store.writeText("app-settings.json", JSON.stringify({ images: "lots", imageQuality: "ultra", imageSameAsText: "yes" }));
    const s = await loadSettings();
    expect([s.images, s.imageQuality, s.imageSameAsText]).toEqual(["none", "low", false]);
  });

  it("use the image key, or the text AI's address and key when the switch is on", async () => {
    await useImages("rich");
    expect((await loadImageConfig()).config).toMatchObject({ baseUrl: "https://img.example.com/v1", apiKey: "sk-image" });
    await useImages("rich", { imageSameAsText: true });
    expect((await loadImageConfig()).config).toMatchObject({ baseUrl: "https://api.example.com/v1", apiKey: "sk-test" });
  });

  it("say what is missing when there is no image key", async () => {
    sessionStorage.clear();
    await setApiKey("sk-test");
    await expect(loadImageConfig()).rejects.toThrow(/no image API key yet/);
  });
});

describe("generateImage (decision 140)", () => {
  const config = { baseUrl: "https://img.example.com/v1/", apiKey: "sk-image", model: "gpt-image-1-mini" };
  const body = imageBody("gpt-image-1-mini", "A gate", "low", PICTURE_SIZE, "webp");

  it("posts the picture request and returns the picture's bytes", async () => {
    const fetch = stubAll();
    expect(await generateImage({ config, body })).toEqual(PNG);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://img.example.com/v1/images/generations");
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "gpt-image-1-mini",
      prompt: "A gate",
      n: 1,
      size: "1536x1024",
      quality: "low",
      output_format: "webp",
    });
  });

  it("fetches the picture when the provider sends a link instead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("/generations") ? json({ data: [{ url: "https://cdn.example.com/p.png" }] }) : new Response(PNG))),
    );
    expect(await generateImage({ config, body })).toEqual(PNG);
  });

  it("tells a refused picture apart, with the provider's words (spec 14.4)", async () => {
    stubAll({ image: () => json({ error: { code: "moderation_blocked", message: "Rejected by the safety system." } }, 400) });
    const error = await generateImage({ config, body }).catch((e) => e);
    expect(error).toBeInstanceOf(PictureRefused);
    expect(error.message).toMatch(/safety rules refused this picture.*Rejected by the safety system/s);
  });

  it("explains a wrong model, no credit and a wrong key in plain words", async () => {
    stubAll({ image: 404 });
    await expect(generateImage({ config, body })).rejects.toThrow(/GPT Image model/);
    stubAll({ image: 402 });
    await expect(generateImage({ config, body })).rejects.toThrow(/no credit left/);
    stubAll({ image: 401 });
    await expect(generateImage({ config, body })).rejects.toThrow(/key was rejected/);
  });

  it("asks for an image model first", async () => {
    await expect(generateImage({ config: { ...config, model: " " }, body })).rejects.toThrow(AiError);
  });
});

describe("drawing a block's picture (spec 14.3, 14.4)", () => {
  async function richDraft(): Promise<{ draft: Draft; version: BlockVersion }> {
    await useImages("rich");
    stubAll();
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "Climb" });
    return { draft, version: draft.blocks[0].versions[0] };
  }

  it("saves the picture under the version's own name and logs the request without the picture", async () => {
    const { version } = await richDraft();
    const fetch = stubAll();
    await drawBlockPicture(story, 1, version);
    const path = blockPicturePath(story.id, version);
    expect(path).toMatch(/\/draft\/pictures\/\d+\.webp$/);
    expect(await store.readBytes(path)).toEqual(PNG);
    expect(pictureState(path)).toBeUndefined();
    const sent = JSON.parse(imageCalls(fetch)[0][1]!.body as string);
    expect(sent.prompt).toContain(`Scene: ${SCENE}`);
    expect(sent.prompt).toContain(getStoryType("cultivation").imageStyle);
    const logs = await store.list(aiLogDir(story.id));
    const log = logs.find((l) => l.name.includes("picture-block-ok"));
    expect(log).toBeTruthy();
    const text = await store.readText(`${aiLogDir(story.id)}/${log!.name}`);
    expect(text).toContain("/images/generations");
    expect(text).toContain("## Prompt");
    expect(text).not.toContain(PNG_B64);
    expect(text).not.toContain("sk-image");
  });

  it("sends the appearance of the characters the scene names", async () => {
    const { characters } = await listCharacters(story);
    const main = characters.find((c) => c.isMain)!;
    await saveCharacter(story, { ...main, values: { ...main.values, name: "Lin Feng", appearance: "A cracked jade pendant" } });
    const { version } = await richDraft();
    const fetch = stubAll();
    await drawBlockPicture(story, 1, version);
    expect(JSON.parse(imageCalls(fetch)[0][1]!.body as string).prompt).toContain("- Lin Feng: A cracked jade pendant");
  });

  it("keeps a refusal as the picture's state and leaves the draft as it was", async () => {
    const { version } = await richDraft();
    const before = await store.readText(`stories/${story.id}/draft/draft.json`);
    stubAll({ image: () => json({ error: { code: "moderation_blocked", message: "No." } }, 400) });
    await drawBlockPicture(story, 1, version);
    const state = pictureState(blockPicturePath(story.id, version));
    expect(state).toMatchObject({ kind: "failed" });
    expect(state?.kind === "failed" && state.error).toMatch(/safety rules refused/);
    expect(await store.readText(`stories/${story.id}/draft/draft.json`)).toBe(before);
    expect(await store.exists(blockPicturePath(story.id, version))).toBe(false);
    // Trying again draws it.
    stubAll();
    await drawBlockPicture(story, 1, version);
    expect(pictureState(blockPicturePath(story.id, version))).toBeUndefined();
    expect(await store.exists(blockPicturePath(story.id, version))).toBe(true);
  });

  it("uses the block's text as the scene when the AI wrote no picture line", async () => {
    await useImages("rich");
    stubAll({ chat: "Lin Feng climbed the stairs.\n\n=== NEXT ===\nGo\nMAIN CHARACTER DIED: no" });
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "Climb" });
    const fetch = stubAll();
    await drawBlockPicture(story, 1, draft.blocks[0].versions[0]);
    expect(JSON.parse(imageCalls(fetch)[0][1]!.body as string).prompt).toContain("Scene: Lin Feng climbed the stairs.");
  });
});

describe("a finished chapter keeps its pictures (spec 14.3, decision 146)", () => {
  const version = (text: string, createdAt: string): BlockVersion => ({ text, actions: [], died: false, hint: "", createdAt });

  it("moves the chosen versions' pictures next to the paragraph that ends their block, and drops the rest", async () => {
    const a = version("One.\n\nTwo.", "2026-11-01T10:00:00.000Z");
    const dropped = version("Old three.", "2026-11-01T10:01:00.000Z");
    const b = version("Three.", "2026-11-01T10:02:00.000Z");
    const c = version("Four.\n\nFive.", "2026-11-01T10:03:00.000Z");
    const draft: Draft = {
      chapter: 1,
      blocks: [
        { direction: "", versions: [a], chosen: 0 },
        { direction: "", versions: [dropped, b], chosen: 1 },
        { direction: "", versions: [c], chosen: 0 },
      ],
    };
    for (const v of [a, dropped, c]) await store.writeBytes(blockPicturePath(story.id, v), PNG);
    await keepChapterPictures(story.id, draft);
    const pictures = await readChapterPictures(story.id, 1);
    expect(pictures.chapter).toBeNull();
    expect(pictures.blocks).toEqual([
      { path: `stories/${story.id}/chapters/001/pictures/001.webp`, afterParagraph: 2 },
      { path: `stories/${story.id}/chapters/001/pictures/003.webp`, afterParagraph: 5 },
    ]);
    expect(await store.readBytes(pictures.blocks[1].path)).toEqual(PNG);
    expect(await store.exists(`stories/${story.id}/draft/pictures`)).toBe(false);
  });

  it("finishChapter keeps a Rich chapter's pictures, and a chapter without any reads as none", async () => {
    await useImages("rich");
    stubAll();
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "Climb" });
    await drawBlockPicture(story, 1, draft.blocks[0].versions[0]);
    await endChapter(story, draft);
    const review = await loadReview(story.id, 1);
    for (const p of review.proposals) {
      if (p.kind === "change") await approveProposal(story, 1, p.id);
      else await rejectProposal(story.id, 1, p.id);
    }
    await finishChapter(story, 1);
    expect((await readChapterPictures(story.id, 1)).blocks).toHaveLength(1);
    expect((await readChapterPictures(story.id, 2)).blocks).toEqual([]);
  });

  it("reads a hand-broken pictures.json as no pictures", async () => {
    await store.writeText(`stories/${story.id}/chapters/001/pictures.json`, "{ not json");
    expect(await readChapterPictures(story.id, 1)).toEqual({ chapter: null, blocks: [] });
  });
});

describe("Lite: one picture per chapter from End Chapter (spec 14.2, 14.3)", () => {
  it("asks the End Chapter call for the chapter's scene only on Lite", () => {
    const input = {
      type: getStoryType("cultivation"),
      language: "English",
      chapter: 1,
      chapterText: "Text",
      storySummary: "",
      characters: [],
      storySummaryTokens: 1000,
      usedScenes: [],
      usedScenesTokens: 300,
    };
    expect(buildEndChapterPrompt({ ...input, picture: true })[0].content).toContain("- picture: one or two sentences in English");
    expect(buildEndChapterPrompt(input)[0].content).not.toContain("- picture:");
    // Decision 145: new characters come with how they look.
    expect(buildEndChapterPrompt(input)[0].content).toContain("- appearance: give every new character one");
  });

  it("saves the scene with the summary and draws the chapter's picture", async () => {
    await saveSettings({ ...(await loadSettings()), images: "none" });
    stubAll({ chat: "Lin Feng climbed.\n\n=== NEXT ===\nGo\nMAIN CHARACTER DIED: no" });
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "Climb" });
    await useImages("lite");
    const fetch = stubAll();
    await endChapter(story, draft);
    expect((await readChapterSummary(story.id, 1))?.picture).toBe(SCENE);
    await vi.waitFor(async () => expect(await store.exists(chapterPicturePath(story.id, 1))).toBe(true));
    expect(imageCalls(fetch)).toHaveLength(1);
    expect((await readChapterPictures(story.id, 1)).chapter).toBe(chapterPicturePath(story.id, 1));
  });

  it("makes no picture and saves no scene on None", async () => {
    await useImages("none");
    const fetch = stubAll({ chat: "Lin Feng climbed.\n\n=== NEXT ===\nGo\nMAIN CHARACTER DIED: no" });
    const draft = await writeBlock({ story, draft: await loadDraft(story), direction: "Climb" });
    await endChapter(story, draft);
    expect((await readChapterSummary(story.id, 1))?.picture).toBeUndefined();
    expect(imageCalls(fetch)).toHaveLength(0);
  });
});

describe("the AI call log of a picture (spec 14.4)", () => {
  it("shows the endpoint, the request besides the prompt, and the prompt", () => {
    const text = formatAiLog({
      kind: "picture-block",
      outcome: "ok",
      startedAt: new Date("2026-11-01T10:00:00Z"),
      durationMs: 1500,
      baseUrl: "https://img.example.com/v1/",
      endpoint: "/images/generations",
      body: imageBody("gpt-image-1-mini", "Style: ink\n\nScene: a gate", "low", PICTURE_SIZE, "webp"),
      facts: { Chapter: "1" },
      response: "(a picture of 120 KB, not written to the log)",
    });
    expect(text).toContain("- **Endpoint:** https://img.example.com/v1/images/generations");
    expect(text).toContain('- **Request body (besides the prompt):** {"model":"gpt-image-1-mini","n":1,"size":"1536x1024","quality":"low","output_format":"webp"}');
    expect(text).toContain("## Prompt\n\n```\nStyle: ink\n\nScene: a gate\n```");
  });
});
