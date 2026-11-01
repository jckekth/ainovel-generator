/**
 * Shared unit-test steps: a story ready to write, and a stubbed AI that answers
 * each kind of call (block, End Chapter, epilogue) as the test says.
 */
import { vi } from "vitest";
import type { ChatMessage } from "../lib/ai";
import { newCharacter, saveCharacter } from "../lib/characters";
import { getSet } from "../lib/curatedSets";
import { setApiKey } from "../lib/secrets";
import { loadSetting, saveSetting } from "../lib/setting";
import { DEFAULT_SETTINGS, saveSettings } from "../lib/settings";
import { createStory, Story } from "../lib/stories";
import { getStoryType } from "../lib/storyTypes";

/**
 * A story (cultivation unless another type is given) with the setting of the
 * type's first curated set, its main character, a key and a model.
 */
export async function readyStory(setting: Record<string, unknown> = {}, type = "cultivation"): Promise<Story> {
  let story = await createStory({ title: "Azure", type, language: "English", setId: getSet(type)?.id });
  const doc = await loadSetting(story);
  doc.values = { ...doc.values, ...setting };
  story = await saveSetting(story, doc);
  const main = newCharacter(getStoryType(type), true);
  await saveCharacter(story, main);
  await setApiKey("sk-test");
  await saveSettings({ ...DEFAULT_SETTINGS, baseUrl: "https://api.example.com/v1", model: "gpt-test" });
  return story;
}

export type CallKind = "block" | "end-chapter" | "epilogue";

export function callKind(messages: ChatMessage[]): CallKind {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  if (system.startsWith("You are the editor")) return "end-chapter";
  if (system.includes("Write the epilogue")) return "epilogue";
  return "block";
}

export const BLOCK = "Lin Feng climbed the stairs.\n\n=== NEXT ===\nKnock on the gate\nTurn back\nMAIN CHARACTER DIED: no";

export const END_CHAPTER = {
  title: "The Gate",
  chapter_summary: "Lin Feng reached the gate and met Elder Wu.",
  story_summary: "Lin Feng left the clan and found a teacher.",
  scenes: ["Leaving home at night", "Meeting a hidden teacher"],
  next_openings: ["Lin Feng begins training at dawn", "A rival clan arrives at the gate"],
  character_changes: [{ character: "Lin Feng", field: "condition", new_value: "Wounded", reason: "A cut." }],
  new_characters: [{ name: "Elder Wu", fields: { age: 70 }, background: "An old teacher.", reason: "Met him." }],
};

/**
 * Stubs fetch with a streamed answer chosen per call. A handler that returns
 * a number answers with that HTTP status instead.
 */
export function stubAi(answer: (kind: CallKind, messages: ChatMessage[]) => string | number) {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { messages } = JSON.parse(init.body as string) as { messages: ChatMessage[] };
    const text = answer(callKind(messages), messages);
    if (typeof text === "number") return new Response("{}", { status: text });
    const pieces = text.match(/[\s\S]{1,7}/g) ?? [];
    const body = pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join("");
    return new Response(body + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** The default stub: normal blocks, a fixed End Chapter answer, and an epilogue. */
export function stubDefaultAi() {
  return stubAi((kind) =>
    kind === "end-chapter" ? JSON.stringify(END_CHAPTER) : kind === "epilogue" ? "Years later, the bell still rang." : BLOCK,
  );
}

/** The messages sent in the nth call. */
export function sentMessages(fetch: ReturnType<typeof stubAi>, call: number): ChatMessage[] {
  return (JSON.parse(fetch.mock.calls[call][1].body as string) as { messages: ChatMessage[] }).messages;
}
