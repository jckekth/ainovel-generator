/**
 * Pictures of the story (spec 14): the picture request, drawing it in the
 * background, and where the files live.
 *
 *   draft/pictures/<key>.webp       Rich: one per block version, named after its createdAt
 *   chapters/<n>/picture.webp       Lite: the chapter's picture
 *   chapters/<n>/pictures/<b>.webp  Rich, once the chapter is finished: the chosen versions'
 *   chapters/<n>/pictures.json      which paragraph of chapter.md each one follows
 *
 * A picture never blocks writing and never changes the draft (spec 14.4). While
 * one is drawing, or after it failed, its state lives here in memory, and pages
 * subscribe to it. Leaving the story lets a picture finish and save.
 */
import { PICTURE_FORMAT, PICTURE_PRICES, PICTURE_SIZE, RICH_PICTURES_PER_CHAPTER } from "../images.config";
import { t } from "../i18n";
import { AiConfig, AiError, generateImage, imageBody } from "./ai";
import { chapterDir, readChapterSummary } from "./chapters";
import { Character, characterName, listCharacters } from "./characters";
import { writeAiLog } from "./devlog";
import { BlockVersion, chosenVersion, Draft } from "./draft";
import { errorText } from "./errors";
import { mentions } from "./scene";
import { getApiKey, getImageKey } from "./secrets";
import { AppSettings, ImageQuality, loadSettings } from "./settings";
import { readJson, store, writeJson } from "./storage";
import { Story, storyDir } from "./stories";
import { getStoryType } from "./storyTypes";

// ---------- what a picture shows (spec 14.2) ----------

/** How much of a block's text stands in for a scene when the AI wrote no picture line (spec 14.4). */
export const SCENE_FROM_TEXT_CHARS = 600;

/** The end of the text, where a block's latest moment is. */
export function sceneFromText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= SCENE_FROM_TEXT_CHARS ? trimmed : `…${trimmed.slice(-SCENE_FROM_TEXT_CHARS)}`;
}

/**
 * The prompt sent to the image model: the story type's style, the scene, and
 * how each character the scene names looks (decisions 143–145). The image
 * model remembers nothing between pictures, so the looks go with every one.
 */
export function picturePrompt(style: string, scene: string, characters: Character[]): string {
  const looks = characters
    .filter((c) => c.values.name && mentions(scene, characterName(c)))
    .map((c) => [characterName(c), String(c.values.appearance ?? "").trim()])
    .filter(([, appearance]) => appearance);
  return [
    `Style: ${style}`,
    `Scene: ${scene}`,
    looks.length ? `How the characters look:\n${looks.map(([name, a]) => `- ${name}: ${a}`).join("\n")}` : "",
    "No text, letters, captions or speech bubbles in the picture.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- cost (spec 14.1, decision 142) ----------

/** US dollars per picture, or null for a model not in the price table. */
export function pictureCost(model: string, quality: ImageQuality): number | null {
  return PICTURE_PRICES[model.trim()]?.[quality] ?? null;
}

export function formatPrice(usd: number): string {
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

/** The cost line in Settings: per picture, and per chapter for Lite and Rich. */
export function costText(model: string, quality: ImageQuality): string {
  const price = pictureCost(model, quality);
  if (price === null) return t("settings.imageCostUnknown", { model: model.trim() || "?" });
  return t("settings.imageCost", {
    model: model.trim(),
    price: formatPrice(price),
    lite: formatPrice(price),
    richMin: formatPrice(price * RICH_PICTURES_PER_CHAPTER.min),
    richMax: formatPrice(price * RICH_PICTURES_PER_CHAPTER.max),
  });
}

// ---------- the image provider (decision 140) ----------

/** The image provider's address, key and model, or a plain-words error saying what is missing. */
export async function loadImageConfig(
  settings?: AppSettings,
): Promise<{ settings: AppSettings; config: AiConfig & { model: string } }> {
  settings ??= await loadSettings();
  const same = settings.imageSameAsText;
  const apiKey = same ? await getApiKey() : await getImageKey();
  if (!apiKey) throw new AiError(t(same ? "error.noKey" : "error.noImageKey"));
  return {
    settings,
    config: { baseUrl: same ? settings.baseUrl : settings.imageBaseUrl, apiKey, model: settings.imageModel },
  };
}

// ---------- drawing, and its state for the pages ----------

export type PictureState = { kind: "drawing" } | { kind: "failed"; error: string };

const states = new Map<string, PictureState>();
const listeners = new Set<() => void>();
let changes = 0;

/** Whether the picture at this path is drawing or failed; undefined otherwise. */
export function pictureState(path: string): PictureState | undefined {
  return states.get(path);
}

/** Calls back whenever a picture starts, ends or fails (for useSyncExternalStore). */
export function subscribePictures(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes on every picture event, so a page knows to look again. */
export function picturesChanged(): number {
  return changes;
}

function setState(path: string, state: PictureState | undefined): void {
  if (state) states.set(path, state);
  else states.delete(path);
  changes += 1;
  listeners.forEach((l) => l());
}

interface DrawRequest {
  story: Story;
  path: string;
  scene: string;
  /** For the log file name. */
  kind: string;
  facts: Record<string, string>;
}

/**
 * Draws one picture and saves it at `path`. Never throws: a failure is kept as
 * the picture's state, with the reason in plain words (spec 14.4).
 */
async function draw(request: DrawRequest): Promise<void> {
  if (states.get(request.path)?.kind === "drawing") return;
  setState(request.path, { kind: "drawing" });
  const startedAt = new Date();
  let logged: { baseUrl: string; body: ReturnType<typeof imageBody> } | null = null;
  const log = (outcome: "ok" | "error", response: string, error?: string) =>
    logged &&
    writeAiLog(request.story.id, {
      kind: request.kind,
      outcome,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      baseUrl: logged.baseUrl,
      endpoint: "/images/generations",
      body: logged.body,
      facts: { ...request.facts, Scene: request.scene },
      response,
      error,
    });
  try {
    const { settings, config } = await loadImageConfig();
    const { characters } = await listCharacters(request.story);
    const prompt = picturePrompt(getStoryType(request.story.type).imageStyle, request.scene, characters);
    const body = imageBody(config.model, prompt, settings.imageQuality, PICTURE_SIZE, PICTURE_FORMAT);
    logged = { baseUrl: config.baseUrl, body };
    const bytes = await generateImage({ config, body });
    await store.writeBytes(request.path, bytes);
    forgetUrl(request.path);
    await log("ok", `(a picture of ${Math.max(1, Math.round(bytes.length / 1024))} KB, not written to the log)`);
    setState(request.path, undefined);
  } catch (e) {
    const error = e instanceof AiError ? e.message : errorText(e);
    await log("error", "", error);
    setState(request.path, { kind: "failed", error });
  }
}

// ---------- Rich: one picture per block version (spec 14.3) ----------

/** A version's picture is named after when it was written, which no other version shares. */
export function versionKey(version: BlockVersion): string {
  return version.createdAt.replace(/\D/g, "") || "version";
}

export const draftPicturesDir = (storyId: string) => `${storyDir(storyId)}/draft/pictures`;

export function blockPicturePath(storyId: string, version: BlockVersion): string {
  return `${draftPicturesDir(storyId)}/${versionKey(version)}.${PICTURE_FORMAT}`;
}

/** Draws a block version's picture from its scene line, or from its text when it has none. */
export function drawBlockPicture(story: Story, chapter: number, version: BlockVersion): Promise<void> {
  return draw({
    story,
    path: blockPicturePath(story.id, version),
    scene: version.picture ?? sceneFromText(version.text),
    kind: "picture-block",
    facts: { Chapter: String(chapter), "Scene from": version.picture ? "the picture line" : "the block's text" },
  });
}

// ---------- Lite: one picture per chapter (spec 14.3) ----------

export function chapterPicturePath(storyId: string, n: number): string {
  return `${chapterDir(storyId, n)}/picture.${PICTURE_FORMAT}`;
}

/** Draws the chapter's picture from the End Chapter call's scene, or from its summary when there is none. */
export async function drawChapterPicture(story: Story, n: number): Promise<void> {
  const summary = await readChapterSummary(story.id, n).catch(() => null);
  const scene = summary?.picture || sceneFromText(summary?.summary ?? "");
  if (!scene) return;
  await draw({
    story,
    path: chapterPicturePath(story.id, n),
    scene,
    kind: "picture-chapter",
    facts: { Chapter: String(n), "Scene from": summary?.picture ? "the End Chapter answer" : "the chapter summary" },
  });
}

// ---------- a finished chapter's pictures ----------

interface PicturesFile {
  blocks: { file: string; afterParagraph: number }[];
}

const picturesJsonPath = (storyId: string, n: number) => `${chapterDir(storyId, n)}/pictures.json`;

/** Paragraphs as the reader splits them: a blank line starts a new one. */
export function paragraphCount(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim()).length;
}

/**
 * At the end of a chapter, keeps the chosen versions' pictures with the chapter
 * and deletes the rest (decision 146). chapter.md is the blocks joined, so a
 * picture's place is the paragraph count up to the end of its block.
 */
export async function keepChapterPictures(storyId: string, draft: Draft): Promise<void> {
  const blocks: PicturesFile["blocks"] = [];
  let paragraphs = 0;
  for (const [i, block] of draft.blocks.entries()) {
    const version = chosenVersion(block);
    paragraphs += paragraphCount(version.text);
    const from = blockPicturePath(storyId, version);
    if (!(await store.exists(from))) continue;
    const file = `pictures/${String(i + 1).padStart(3, "0")}.${PICTURE_FORMAT}`;
    await store.writeBytes(`${chapterDir(storyId, draft.chapter)}/${file}`, await store.readBytes(from));
    blocks.push({ file, afterParagraph: paragraphs });
  }
  if (blocks.length) await writeJson(picturesJsonPath(storyId, draft.chapter), { blocks });
  await store.remove(draftPicturesDir(storyId));
}

export interface ChapterPictures {
  /** The Lite picture's path, if there is one. */
  chapter: string | null;
  /** Rich pictures, each after the paragraph it follows (counted from 1). */
  blocks: { path: string; afterParagraph: number }[];
}

export async function readChapterPictures(storyId: string, n: number): Promise<ChapterPictures> {
  const lite = chapterPicturePath(storyId, n);
  const out: ChapterPictures = { chapter: (await store.exists(lite)) ? lite : null, blocks: [] };
  const json = picturesJsonPath(storyId, n);
  if (!(await store.exists(json))) return out;
  try {
    const file = await readJson<Partial<PicturesFile>>(json);
    for (const b of Array.isArray(file.blocks) ? file.blocks : []) {
      if (typeof b?.file !== "string" || !Number.isInteger(b.afterParagraph) || b.file.includes("..")) continue;
      out.blocks.push({ path: `${chapterDir(storyId, n)}/${b.file}`, afterParagraph: b.afterParagraph });
    }
  } catch {
    // A hand-broken pictures.json still leaves the chapter readable, without its pictures.
  }
  return out;
}

// ---------- showing a picture ----------

const urls = new Map<string, string>();

function forgetUrl(path: string): void {
  const url = urls.get(path);
  if (url) URL.revokeObjectURL(url);
  urls.delete(path);
}

/** The picture's media type from its first bytes; providers may send another format than asked. */
function mediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return "image/webp";
}

/** A URL the page can show for the picture at `path`, or null when there is no picture yet. */
export async function pictureUrl(path: string): Promise<string | null> {
  const known = urls.get(path);
  if (known) return known;
  if (!(await store.exists(path))) return null;
  const bytes = await store.readBytes(path);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType(bytes) }));
  urls.set(path, url);
  return url;
}
