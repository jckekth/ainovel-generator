/**
 * AI call log for development builds (decision 46).
 *
 * In `npm run tauri dev` and `npm run dev`, every block request is saved as a
 * readable markdown file in stories/<id>/ai-log/, so the user can check what
 * the prompt held and what the AI really answered. Installed builds write
 * nothing. The API key is never part of an entry.
 */
import type { ChatMessage } from "./ai";
import { store } from "./storage";
import { storyDir } from "./stories";

/** True in development builds (Vite dev server and Vitest), false in the installed app. */
export const AI_LOG_ENABLED = import.meta.env.DEV;

/** How many log files are kept per story; older ones are deleted. */
export const AI_LOG_KEEP = 100;

export const aiLogDir = (storyId: string) => `${storyDir(storyId)}/ai-log`;

export interface AiLogEntry {
  /** What the call was for, e.g. "block" or "regenerate". */
  kind: string;
  outcome: "ok" | "error" | "stopped";
  startedAt: Date;
  durationMs: number;
  baseUrl: string;
  /** The request body exactly as sent (chatBody, or imageBody for a picture, in ai.ts). */
  body: { model: string; messages: ChatMessage[]; stream: boolean } | { model: string; prompt: string };
  /** The path after the base URL; chat completions when left out. */
  endpoint?: string;
  /** Facts about the prompt worth seeing at a glance: budget, layers, characters in the scene… */
  facts: Record<string, string>;
  /** The raw answer; after an error or Stop, the part that had arrived. */
  response: string;
  error?: string;
}

/** Longest run of backticks in the text, so a code fence around it can be one longer. */
function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(longest + 1);
}

function block(text: string): string {
  const f = fence(text);
  return `${f}\n${text}\n${f}`;
}

export function formatAiLog(entry: AiLogEntry): string {
  // A picture request has one prompt instead of messages (spec 14.4).
  const { messages, prompt, ...rest } = { messages: [] as ChatMessage[], prompt: undefined as string | undefined, ...entry.body };
  const facts: [string, string][] = [
    ["Time", entry.startedAt.toISOString()],
    ["Kind", entry.kind],
    ["Outcome", entry.outcome],
    ["Duration", `${(entry.durationMs / 1000).toFixed(1)} s`],
    ["Endpoint", `${entry.baseUrl.trim().replace(/\/+$/, "")}${entry.endpoint ?? "/chat/completions"}`],
    [prompt === undefined ? "Request body (besides messages)" : "Request body (besides the prompt)", JSON.stringify(rest)],
    ...Object.entries(entry.facts),
    ["Response length", `${entry.response.length} characters`],
  ];
  const parts = [
    `# AI call: ${entry.kind}, ${entry.outcome}`,
    facts.map(([k, v]) => `- **${k}:** ${v}`).join("\n"),
  ];
  if (entry.error) parts.push(`## Error\n\n${entry.error}`);
  if (prompt !== undefined) parts.push(`## Prompt\n\n${block(prompt)}`);
  messages.forEach((m, i) => parts.push(`## Message ${i + 1}: ${m.role}\n\n${block(m.content)}`));
  parts.push(`## Response (raw)\n\n${block(entry.response || "(nothing arrived)")}`);
  return parts.join("\n\n") + "\n";
}

/** File names sort by time: 2026-10-08T09-30-05-123Z-block-ok.md */
export function aiLogFileName(entry: AiLogEntry): string {
  const stamp = entry.startedAt.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${entry.kind}-${entry.outcome}.md`;
}

/**
 * Saves one entry and deletes the oldest files beyond AI_LOG_KEEP. Never
 * throws: a log that cannot be written must not break writing the story.
 */
export async function writeAiLog(storyId: string, entry: AiLogEntry): Promise<void> {
  if (!AI_LOG_ENABLED) return;
  try {
    await store.writeText(`${aiLogDir(storyId)}/${aiLogFileName(entry)}`, formatAiLog(entry));
    const files = (await store.list(aiLogDir(storyId)))
      .filter((e) => !e.isDirectory && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - AI_LOG_KEEP))) {
      await store.remove(`${aiLogDir(storyId)}/${name}`);
    }
  } catch (e) {
    console.warn("The AI call log could not be written:", e);
  }
}
