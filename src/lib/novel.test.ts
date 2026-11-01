import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, AiStopped } from "./ai";
import { newCharacter, saveCharacter } from "./characters";
import { aiLogDir } from "./devlog";
import { appendBlock, BlockVersion, Draft, draftPath, loadDraft } from "./draft";
import { deathCanBeAccepted, nextBlockBlocked, writeBlock } from "./novel";
import { setApiKey } from "./secrets";
import { loadSetting, saveSetting } from "./setting";
import { DEFAULT_SETTINGS, saveSettings } from "./settings";
import { store } from "./storage";
import { createStory, getStory, Story } from "./stories";
import { getStoryType } from "./storyTypes";

const BLOCK = "Lin Feng climbed the stairs.\n\n=== NEXT ===\nKnock on the gate\nTurn back\nMAIN CHARACTER DIED: no";

/** Stubs fetch with a streamed answer of the given text, in small pieces. */
function stubStream(text: string) {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const pieces = text.match(/.{1,7}/gs) ?? [];
    const body = pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join("");
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return new Response(body + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const sentPrompt = (fetch: ReturnType<typeof stubStream>, call = 0) =>
  (JSON.parse(fetch.mock.calls[call][1].body as string).messages as { content: string }[])
    .map((m) => m.content)
    .join("\n");

let story: Story;
const empty = (): Draft => ({ chapter: 1, blocks: [] });

beforeEach(async () => {
  story = await createStory({ title: "Azure", type: "cultivation", language: "English" });
  const setting = await loadSetting(story);
  setting.background = "Nine peaks float above a sea of clouds.";
  story = await saveSetting(story, setting);
  const main = newCharacter(getStoryType("cultivation"), true);
  main.values = { ...main.values, name: "Lin Feng", special_ability: "Sees qi." };
  await saveCharacter(story, main);
  await setApiKey("sk-test");
  await saveSettings({ ...DEFAULT_SETTINGS, baseUrl: "https://api.example.com/v1", model: "gpt-test" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("writeBlock (spec 5.1)", () => {
  it("writes the first block, saves the draft and returns it", async () => {
    stubStream(BLOCK);
    const draft = await writeBlock({ story, draft: empty(), direction: " Open at the gate " });
    expect(draft.blocks).toHaveLength(1);
    expect(draft.blocks[0]).toMatchObject({ direction: "Open at the gate", chosen: 0 });
    expect(draft.blocks[0].versions[0]).toMatchObject({
      text: "Lin Feng climbed the stairs.",
      actions: ["Knock on the gate", "Turn back"],
      died: false,
      hint: "",
    });
    expect(await loadDraft(story)).toEqual(draft);
  });

  it("sends the setting, the main character and the direction", async () => {
    const fetch = stubStream(BLOCK);
    await writeBlock({ story, draft: empty(), direction: "Open at the gate" });
    const prompt = sentPrompt(fetch);
    expect(prompt).toContain("Nine peaks float above a sea of clouds.");
    expect(prompt).toContain("### Lin Feng (main character)");
    expect(prompt).toContain("Direction: Open at the gate");
  });

  it("reports only the story text while streaming, never the suggestions", async () => {
    stubStream(BLOCK);
    const seen: string[] = [];
    await writeBlock({ story, draft: empty(), direction: "", onText: (t) => seen.push(t) });
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.at(-1)).toBe("Lin Feng climbed the stairs.");
    expect(seen.some((t) => t.includes("=") || t.includes("Knock"))).toBe(false);
  });

  it("stores the died flag (spec 5.5)", async () => {
    stubStream(BLOCK.replace("DIED: no", "DIED: yes"));
    const draft = await writeBlock({ story, draft: empty(), direction: "" });
    expect(draft.blocks[0].versions[0].died).toBe(true);
  });

  it("keeps a block without suggestions (decision 37)", async () => {
    stubStream("Lin Feng climbed the stairs.");
    const draft = await writeBlock({ story, draft: empty(), direction: "" });
    expect(draft.blocks[0].versions[0]).toMatchObject({ text: "Lin Feng climbed the stairs.", actions: [] });
  });

  it("sends the blocks so far for the next block, and fixes the earlier version", async () => {
    const fetch = stubStream(BLOCK);
    let draft = await writeBlock({ story, draft: empty(), direction: "" });
    draft = await writeBlock({ story, draft, regenerate: { hint: "" } });
    draft = await writeBlock({ story, draft, direction: "Knock on the gate" });
    expect(sentPrompt(fetch, 2)).toContain("## Chapter 1 so far\nLin Feng climbed the stairs.");
    expect(draft.blocks.map((b) => b.versions.length)).toEqual([1, 1]);
  });
});

describe("writeBlock regenerate (spec 5.2)", () => {
  it("adds a version of the latest block with the hint, keeping the earlier one", async () => {
    stubStream(BLOCK);
    const first = await writeBlock({ story, draft: empty(), direction: "Open at the gate" });
    const fetch = stubStream(BLOCK.replace("climbed", "ran up"));
    const draft = await writeBlock({ story, draft: first, regenerate: { hint: " shorter " } });

    expect(draft.blocks).toHaveLength(1);
    expect(draft.blocks[0].chosen).toBe(1);
    expect(draft.blocks[0].versions.map((v) => v.text)).toEqual([
      "Lin Feng climbed the stairs.",
      "Lin Feng ran up the stairs.",
    ]);
    expect(draft.blocks[0].versions[1].hint).toBe("shorter");

    // The block being replaced is not sent; its direction and the hint are.
    const prompt = sentPrompt(fetch);
    expect(prompt).not.toContain("Lin Feng climbed the stairs.");
    expect(prompt).toContain("Direction: Open at the gate\nHint for this version: shorter");
    expect(await loadDraft(story)).toEqual(draft);
  });

  it("refuses to regenerate when there is no block", async () => {
    await expect(writeBlock({ story, draft: empty(), regenerate: { hint: "" } })).rejects.toThrow(
      "There is no block to regenerate yet.",
    );
  });
});

describe("writeBlock failures leave the draft unchanged (spec 9, decision 38)", () => {
  async function withOneBlock() {
    stubStream(BLOCK);
    const draft = await writeBlock({ story, draft: empty(), direction: "" });
    return { draft, file: await store.readText(draftPath(story.id)) };
  }

  it("on an error status", async () => {
    const { draft, file } = await withOneBlock();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(writeBlock({ story, draft, direction: "Go" })).rejects.toThrow(/Wait a minute and try again/);
    expect(await store.readText(draftPath(story.id))).toBe(file);
  });

  it("with the network off", async () => {
    const { draft, file } = await withOneBlock();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(writeBlock({ story, draft, regenerate: { hint: "" } })).rejects.toThrow(/Could not reach/);
    expect(await store.readText(draftPath(story.id))).toBe(file);
  });

  it("when Stop is pressed", async () => {
    const { draft, file } = await withOneBlock();
    const controller = new AbortController();
    controller.abort();
    await expect(writeBlock({ story, draft, direction: "Go", signal: controller.signal })).rejects.toBeInstanceOf(
      AiStopped,
    );
    expect(await store.readText(draftPath(story.id))).toBe(file);
  });

  it("when the AI sends back an empty block", async () => {
    const { draft, file } = await withOneBlock();
    stubStream("\n=== NEXT ===\nGo\nMAIN CHARACTER DIED: no");
    const err = await writeBlock({ story, draft, direction: "Go" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toBe("The AI sent back an empty block. Try again.");
    expect(await store.readText(draftPath(story.id))).toBe(file);
  });

  it("when the answer is cut off, by a closed stream or the output limit (decision 74)", async () => {
    const { draft, file } = await withOneBlock();
    const half = `data: ${JSON.stringify({ choices: [{ delta: { content: "Lin Feng reached for the" } }] })}\n\n`;
    const cut = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\ndata: [DONE]\n\n`;
    for (const body of [half, half + cut]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })));
      await expect(writeBlock({ story, draft, direction: "Go" })).rejects.toBeInstanceOf(AiError);
      expect(await store.readText(draftPath(story.id))).toBe(file);
    }
  });

  it("asks for an API key first", async () => {
    sessionStorage.clear();
    await expect(writeBlock({ story, draft: empty(), direction: "" })).rejects.toThrow(
      "There is no API key yet. Add one in Settings, then try again.",
    );
    expect(await store.exists(draftPath(story.id))).toBe(false);
  });

  it("asks for a model first", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, model: "" });
    await expect(writeBlock({ story, draft: empty(), direction: "" })).rejects.toThrow(
      "Choose a model in Settings first.",
    );
  });
});

describe("writeBlock bookkeeping", () => {
  it("moves the story to the top of the story list", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    try {
      stubStream(BLOCK);
      await writeBlock({ story, draft: empty(), direction: "" });
      expect((await getStory(story.id)).updatedAt).toBe("2030-01-01T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("writeBlock AI call log (decision 46)", () => {
  async function logs() {
    const names = (await store.list(aiLogDir(story.id))).map((e) => e.name).sort();
    return Promise.all(names.map(async (n) => ({ name: n, text: await store.readText(`${aiLogDir(story.id)}/${n}`) })));
  }

  it("logs a successful block with its prompt, answer and parsed result, but never the key", async () => {
    stubStream(BLOCK);
    await writeBlock({ story, draft: empty(), direction: "Open at the gate" });
    const [log] = await logs();
    expect(log.name).toMatch(/-block-ok\.md$/);
    expect(log.text).toContain("### Lin Feng (main character)");
    expect(log.text).toContain("Direction: Open at the gate");
    expect(log.text).toContain(BLOCK);
    expect(log.text).toContain("- **Suggested actions:** Knock on the gate | Turn back");
    expect(log.text).toContain("- **Chapter length setting:** Medium");
    expect(log.text).not.toContain("sk-test");
  });

  it("logs an error with what had arrived, and a stopped or regenerated call", async () => {
    stubStream(BLOCK);
    const draft = await writeBlock({ story, draft: empty(), direction: "" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await writeBlock({ story, draft, regenerate: { hint: "shorter" } }).catch(() => undefined);
    stubStream(BLOCK);
    const controller = new AbortController();
    controller.abort();
    await writeBlock({ story, draft, direction: "Go", signal: controller.signal }).catch(() => undefined);

    const all = await logs();
    expect(all.map((l) => l.name.replace(/^.*Z-/, ""))).toEqual(
      expect.arrayContaining(["block-ok.md", "block-regenerate-error.md", "block-stopped.md"]),
    );
    const failed = all.find((l) => l.name.endsWith("block-regenerate-error.md"))!;
    expect(failed.text).toContain("## Error\n\nThe provider had a server error (500).");
    expect(failed.text).toContain("Hint for this version: shorter");
  });
});

describe("nextBlockBlocked (spec 5.3, 5.5, decision 49)", () => {
  const v = (text: string, died = false): BlockVersion => ({ text, actions: [], died, hint: "", createdAt: "" });
  const words = (n: number) => Array(n).fill("word").join(" ");
  const setting = { chapter_length: "Short", language: "English" };
  const draftOf = (...versions: BlockVersion[]) =>
    versions.reduce((d, version) => appendBlock(d, "", version), { chapter: 1, blocks: [] } as Draft);

  it("allows the first block and blocks below the hard limit", () => {
    expect(nextBlockBlocked({ chapter: 1, blocks: [] }, setting)).toBeNull();
    expect(nextBlockBlocked(draftOf(v(words(1600))), setting)).toBeNull();
    // The block that crosses the hard limit is written; it becomes the conclusion only on the next turn.
    expect(nextBlockBlocked(draftOf(v(words(2300))), setting)).toBeNull();
  });

  it("stops after the concluding block, written once the chapter had reached its hard limit", () => {
    expect(nextBlockBlocked(draftOf(v(words(2300)), v("The end of the chapter.")), setting)).toMatch(
      /reached its length limit\. End the chapter/,
    );
  });

  it("pauses on a death until it is regenerated or accepted", () => {
    expect(nextBlockBlocked(draftOf(v("He fell.", true)), setting)).toMatch(/main character died/);
  });

  it("under Never, a death can only be regenerated (spec 5.5, decision 62)", () => {
    const never = { ...setting, main_character_death: "Never" };
    expect(nextBlockBlocked(draftOf(v("He fell.", true)), never)).toMatch(/set to Never. Regenerate the block.$/);
    expect(deathCanBeAccepted(never)).toBe(false);
    expect(deathCanBeAccepted(setting)).toBe(true);
    expect(deathCanBeAccepted({ ...setting, main_character_death: "The AI may decide" })).toBe(true);
  });

  it("allows only one epilogue block", () => {
    expect(nextBlockBlocked({ ...draftOf(v("The end.")), epilogue: true }, setting)).toMatch(/epilogue is written/);
  });

  it("is enforced by writeBlock, which still allows a regenerate", async () => {
    stubStream(BLOCK.replace("DIED: no", "DIED: yes"));
    const draft = await writeBlock({ story, draft: empty(), direction: "" });
    await expect(writeBlock({ story, draft, direction: "Go on" })).rejects.toThrow(/main character died/);
    stubStream(BLOCK);
    const undone = await writeBlock({ story, draft, regenerate: { hint: "he lives" } });
    expect(undone.blocks[0].versions[1].died).toBe(false);
  });
});

describe("tokens and notes on blocks (spec 6.6, decision 86)", () => {
  /** A stream with the usage report that include_usage asks for. */
  function stubWithUsage(text: string, prompt: number, completion: number) {
    const fn = vi.fn(async (_url: string, init: RequestInit) => {
      const asked = !!JSON.parse(init.body as string).stream_options?.include_usage;
      const usage = asked ? `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion } })}\n\n` : "";
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n${usage}data: [DONE]\n\n`;
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("keeps the provider's tokens on the version and in the chapter's total, regenerations included", async () => {
    stubWithUsage("Lin Feng waited.\n=== NEXT ===\nKnock | The gate opens\nLeave\nMAIN CHARACTER DIED: no", 1200, 300);
    let draft = await writeBlock({ story, draft: empty(), direction: "" });
    expect(draft.blocks[0].versions[0]).toMatchObject({
      actions: ["Knock", "Leave"],
      notes: ["The gate opens", ""],
      tokens: { input: 1200, output: 300 },
    });
    draft = await writeBlock({ story, draft, regenerate: { hint: "" } });
    draft = await writeBlock({ story, draft, direction: "Knock" });
    expect(draft.tokens).toEqual({ input: 3600, output: 900 });
    expect((await loadDraft(story)).tokens).toEqual({ input: 3600, output: 900 });
  });

  it("estimates the tokens when the provider sends no report", async () => {
    stubStream(BLOCK);
    const draft = await writeBlock({ story, draft: empty(), direction: "" });
    expect(draft.blocks[0].versions[0].tokens).toMatchObject({ estimated: true });
    expect(draft.blocks[0].versions[0].tokens!.input).toBeGreaterThan(100);
  });

  it("asks the AI for a note after each action", async () => {
    const fetch = stubStream(BLOCK);
    await writeBlock({ story, draft: empty(), direction: "" });
    expect(sentPrompt(fetch)).toContain('After each action write " | " and a note');
  });

  it("counts nothing for a stopped block (spec 6.6)", async () => {
    stubStream(BLOCK);
    const controller = new AbortController();
    controller.abort();
    await expect(writeBlock({ story, draft: empty(), direction: "", signal: controller.signal })).rejects.toBeInstanceOf(AiStopped);
    expect((await loadDraft(story)).tokens).toBeUndefined();
  });
});

describe("the AI call log after the stream_options retry (decision 87, CR6-05)", () => {
  it("records the body that answered, without stream_options", async () => {
    const fn = vi.fn(async (_url: string, init: RequestInit) => {
      if (JSON.parse(init.body as string).stream_options) {
        return new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } }), { status: 400 });
      }
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: BLOCK } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fn);
    await writeBlock({ story, draft: empty(), direction: "" });
    const [name] = (await store.list(aiLogDir(story.id))).map((e) => e.name);
    const log = await store.readText(`${aiLogDir(story.id)}/${name}`);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(log).toContain('"stream":true');
    expect(log).not.toContain("stream_options");
  });
});

describe("a stale draft (bug 2026-10-22)", () => {
  it("refuses to write over blocks the page has not seen, and changes nothing", async () => {
    stubStream(BLOCK);
    const stale = empty();
    const fresh = await writeBlock({ story, draft: stale, direction: "" });
    await expect(writeBlock({ story, draft: stale, direction: "Again" })).rejects.toThrow(/changed since this page was opened/);
    expect(await loadDraft(story)).toEqual(fresh);
  });
});
