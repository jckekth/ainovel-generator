import { describe, expect, it, vi } from "vitest";
import { AI_LOG_ENABLED, AI_LOG_KEEP, aiLogDir, aiLogFileName, AiLogEntry, formatAiLog, writeAiLog } from "./devlog";
import { store } from "./storage";

const entry = (patch: Partial<AiLogEntry> = {}): AiLogEntry => ({
  kind: "block",
  outcome: "ok",
  startedAt: new Date("2026-10-08T09:30:05.123Z"),
  durationMs: 2345,
  baseUrl: "http://127.0.0.1:8787/v1/",
  body: {
    model: "mock-novelist-v1",
    messages: [
      { role: "system", content: "You are a novelist.\n\n## How to write\n- Language: English." },
      { role: "user", content: "## Setting\nchapter_length: Short" },
    ],
    stream: true,
  },
  facts: { "Context budget": "balanced", "Chapter length setting": "Short" },
  response: "The bell rang.\n=== NEXT ===\nGo\nMAIN CHARACTER DIED: no",
  ...patch,
});

describe("AI call log (decision 46)", () => {
  it("is on in development builds and tests", () => {
    expect(AI_LOG_ENABLED).toBe(true);
  });

  it("writes every message exactly as sent, and the raw answer", () => {
    const text = formatAiLog(entry());
    expect(text.startsWith("# AI call: block, ok\n")).toBe(true);
    expect(text).toContain("## Message 1: system\n\n```\nYou are a novelist.\n\n## How to write\n- Language: English.\n```");
    expect(text).toContain("## Message 2: user\n\n```\n## Setting\nchapter_length: Short\n```");
    expect(text).toContain("## Response (raw)\n\n```\nThe bell rang.\n=== NEXT ===\nGo\nMAIN CHARACTER DIED: no\n```");
  });

  it("lists the call's facts: time, outcome, duration, endpoint, body fields and prompt facts", () => {
    const text = formatAiLog(entry());
    expect(text).toContain("- **Time:** 2026-10-08T09:30:05.123Z");
    expect(text).toContain("- **Duration:** 2.3 s");
    expect(text).toContain("- **Endpoint:** http://127.0.0.1:8787/v1/chat/completions");
    expect(text).toContain('- **Request body (besides messages):** {"model":"mock-novelist-v1","stream":true}');
    expect(text).toContain("- **Chapter length setting:** Short");
  });

  it("records the error and the part that arrived", () => {
    const text = formatAiLog(entry({ outcome: "error", error: "The connection broke off.", response: "Half a" }));
    expect(text).toContain("## Error\n\nThe connection broke off.");
    expect(text).toContain("```\nHalf a\n```");
    expect(formatAiLog(entry({ outcome: "stopped", response: "" }))).toContain("(nothing arrived)");
  });

  it("keeps a fence intact when the text itself has backticks", () => {
    const text = formatAiLog(entry({ response: "a ``` b" }));
    expect(text).toContain("````\na ``` b\n````");
  });

  it("names files so they sort by time", () => {
    expect(aiLogFileName(entry())).toBe("2026-10-08T09-30-05-123Z-block-ok.md");
    expect(aiLogFileName(entry({ kind: "regenerate", outcome: "stopped" }))).toBe(
      "2026-10-08T09-30-05-123Z-regenerate-stopped.md",
    );
  });

  it("saves the entry in the story's ai-log folder", async () => {
    await writeAiLog("s1", entry());
    expect(await store.readText(`${aiLogDir("s1")}/2026-10-08T09-30-05-123Z-block-ok.md`)).toBe(formatAiLog(entry()));
  });

  it(`keeps only the newest ${AI_LOG_KEEP} files`, async () => {
    const start = Date.UTC(2026, 9, 8);
    for (let i = 0; i < AI_LOG_KEEP + 3; i++) {
      await store.writeText(`${aiLogDir("s1")}/${aiLogFileName(entry({ startedAt: new Date(start + i * 1000) }))}`, "x");
    }
    await writeAiLog("s1", entry({ startedAt: new Date(start + 999_000) }));
    const names = (await store.list(aiLogDir("s1"))).map((e) => e.name).sort();
    expect(names).toHaveLength(AI_LOG_KEEP);
    expect(names[0]).toBe(aiLogFileName(entry({ startedAt: new Date(start + 4000) })));
    expect(names.at(-1)).toBe(aiLogFileName(entry({ startedAt: new Date(start + 999_000) })));
  });

  it("never throws when the log cannot be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const write = vi.spyOn(store, "writeText").mockRejectedValueOnce(new Error("disk full"));
    await expect(writeAiLog("s1", entry())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    write.mockRestore();
    warn.mockRestore();
  });
});
