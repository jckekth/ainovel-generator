/**
 * Finished chapters (spec 3, 5.4, 5.6): stories/<id>/chapters/001/
 *
 *   chapter.md     the chapter's text; written once, never changed. Its
 *                  existence marks the chapter as ended (decision 50).
 *   summary.md     YAML header with the title, the next chapter's openings,
 *                  the tokens the chapter used (spec 6.6) and the scene for
 *                  its Lite picture (spec 14.2);
 *                  body: the AI's chapter summary
 *   review.json    the AI's proposed character changes (see endChapter.ts)
 *   snapshot/      setting.md and characters/ as they were at the chapter's end
 *
 * The story's "story so far" summary is stories/<id>/summary.md, and its used
 * scenes list (spec 6.4) is stories/<id>/scenes.md, one "- " line per scene.
 */
import { t } from "../i18n";
import { stripFlagLines, stripSuggestions } from "./block";
import { formatMarkDoc, parseMarkDoc } from "./markdoc";
import { store } from "./storage";
import { storyDir } from "./stories";
import { readTokens, Tokens } from "./tokens";

export const chaptersDir = (storyId: string) => `${storyDir(storyId)}/chapters`;
export const chapterDir = (storyId: string, n: number) => `${chaptersDir(storyId)}/${String(n).padStart(3, "0")}`;
const chapterPath = (storyId: string, n: number) => `${chapterDir(storyId, n)}/chapter.md`;
const summaryPath = (storyId: string, n: number) => `${chapterDir(storyId, n)}/summary.md`;
const storySummaryPath = (storyId: string) => `${storyDir(storyId)}/summary.md`;
const scenesPath = (storyId: string) => `${storyDir(storyId)}/scenes.md`;

export interface ChapterInfo {
  number: number;
  /** From summary.md; "Chapter N" until the summary exists. */
  title: string;
  /** False while the End Chapter call has not succeeded yet (spec 5.4). */
  hasSummary: boolean;
}

export function defaultTitle(n: number): string {
  return `Chapter ${n}`;
}

export async function chapterEnded(storyId: string, n: number): Promise<boolean> {
  return store.exists(chapterPath(storyId, n));
}

/** Saves the chapter's text. Refuses to overwrite: a finished chapter is read-only (spec 5.4). */
export async function saveChapterText(storyId: string, n: number, text: string): Promise<void> {
  if (await chapterEnded(storyId, n)) {
    throw new Error(t("error.chapterSaved", { n: String(n) }));
  }
  await store.writeText(chapterPath(storyId, n), text.trim() + "\n");
}

export async function readChapterText(storyId: string, n: number): Promise<string> {
  // chapter.md is never rewritten; a flag line saved before decision 54, and suggestions
  // saved before decision 90, are left out when it is read.
  return stripSuggestions(stripFlagLines((await store.readText(chapterPath(storyId, n))).trim()));
}

export interface ChapterSummary {
  title: string;
  summary: string;
  /** Two or three ways the next chapter could open (decision 65). Empty for chapters ended before them. */
  openings?: string[];
  /** Every AI call of the chapter, End Chapter included (spec 6.6). Missing for chapters ended before phase 6. */
  tokens?: Tokens;
  /** The chapter's key scene for its Lite picture, in English (spec 14.2). Missing when none was asked for. */
  picture?: string;
}

function lines(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
}

export async function readChapterSummary(storyId: string, n: number): Promise<ChapterSummary | null> {
  if (!(await store.exists(summaryPath(storyId, n)))) return null;
  const doc = parseMarkDoc(await store.readText(summaryPath(storyId, n)));
  const title = String(doc.header.title ?? "").trim() || defaultTitle(n);
  const summary: ChapterSummary = { title, summary: doc.body.trim(), openings: lines(doc.header.openings) };
  const tokens = readTokens(doc.header.tokens);
  if (tokens) summary.tokens = tokens;
  const picture = String(doc.header.picture ?? "").trim();
  if (picture) summary.picture = picture;
  return summary;
}

export async function saveChapterSummary(storyId: string, n: number, s: ChapterSummary): Promise<void> {
  const title = s.title.trim() || defaultTitle(n);
  const openings = lines(s.openings);
  const header: Record<string, unknown> = openings.length ? { title, openings } : { title };
  if (s.tokens) header.tokens = s.tokens;
  if (s.picture?.trim()) header.picture = s.picture.trim();
  await store.writeText(summaryPath(storyId, n), formatMarkDoc({ header, body: s.summary.trim() }));
}

/** Changes only the title; the AI's summary stays as written (spec 5.4 step 3). */
export async function renameChapter(storyId: string, n: number, title: string): Promise<void> {
  const current = await readChapterSummary(storyId, n);
  if (!current) throw new Error(t("error.noSummaryToRename", { n: String(n) }));
  await saveChapterSummary(storyId, n, { ...current, title });
}

/** Every ended chapter, in order. */
export async function listChapters(storyId: string): Promise<ChapterInfo[]> {
  const out: ChapterInfo[] = [];
  for (const entry of await store.list(chaptersDir(storyId))) {
    const n = Number(entry.name);
    if (!entry.isDirectory || !Number.isInteger(n) || n < 1 || !(await chapterEnded(storyId, n))) continue;
    let summary: ChapterSummary | null = null;
    try {
      summary = await readChapterSummary(storyId, n);
    } catch {
      // A hand-broken summary.md still leaves the chapter readable.
    }
    out.push({ number: n, title: summary?.title ?? defaultTitle(n), hasSummary: summary !== null });
  }
  return out.sort((a, b) => a.number - b.number);
}

export async function readStorySummary(storyId: string): Promise<string> {
  if (!(await store.exists(storySummaryPath(storyId)))) return "";
  return (await store.readText(storySummaryPath(storyId))).trim();
}

export async function saveStorySummary(storyId: string, text: string): Promise<void> {
  await store.writeText(storySummaryPath(storyId), text.trim() + "\n");
}

/** The used scenes list (spec 6.4); empty for a story begun before it. */
export async function readUsedScenes(storyId: string): Promise<string[]> {
  if (!(await store.exists(scenesPath(storyId)))) return [];
  return (await store.readText(scenesPath(storyId)))
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

export async function saveUsedScenes(storyId: string, scenes: string[]): Promise<void> {
  await store.writeText(scenesPath(storyId), scenes.map((l) => `- ${l.trim()}`).join("\n") + "\n");
}

/** Copies setting.md and the character files into the chapter's snapshot folder (spec 5.4 step 4, decision 12). */
export async function snapshotChapter(storyId: string, n: number): Promise<void> {
  const target = `${chapterDir(storyId, n)}/snapshot`;
  await store.remove(target);
  const setting = `${storyDir(storyId)}/setting.md`;
  if (await store.exists(setting)) await store.writeText(`${target}/setting.md`, await store.readText(setting));
  const characters = `${storyDir(storyId)}/characters`;
  for (const entry of await store.list(characters)) {
    if (entry.isDirectory || !entry.name.endsWith(".md")) continue;
    await store.writeText(`${target}/characters/${entry.name}`, await store.readText(`${characters}/${entry.name}`));
  }
}

/** What the prompt needs from earlier chapters (spec 6.1 layers 5–8). */
export interface StoryContext {
  storySummary: string;
  usedScenes: string[];
  /** Summaries of finished chapters before `chapter`, oldest first. */
  chapterSummaries: string[];
  /** The text of the chapter just before `chapter`, or "". */
  previousChapter: string;
  /** Texts of up to the last 3 chapters before `chapter`, oldest first. */
  recentChapters: string[];
}

export async function loadStoryContext(storyId: string, chapter: number): Promise<StoryContext> {
  const earlier = (await listChapters(storyId)).filter((c) => c.number < chapter);
  const chapterSummaries: string[] = [];
  for (const c of earlier) {
    const s = c.hasSummary ? await readChapterSummary(storyId, c.number) : null;
    if (s?.summary) chapterSummaries.push(`Chapter ${c.number}, "${s.title}": ${s.summary}`);
  }
  const recentChapters: string[] = [];
  for (const c of earlier.slice(-3)) recentChapters.push(await readChapterText(storyId, c.number));
  const previous = earlier.at(-1);
  return {
    storySummary: await readStorySummary(storyId),
    usedScenes: await readUsedScenes(storyId),
    chapterSummaries,
    previousChapter: previous && previous.number === chapter - 1 ? recentChapters.at(-1) ?? "" : "",
    recentChapters,
  };
}
