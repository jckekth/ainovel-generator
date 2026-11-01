/**
 * Writing one block of the chapter (spec 5.1, 5.2), or the epilogue (spec 5.5):
 * gather the story files, build the prompt, stream the answer, and save the
 * draft once the block has arrived in full. Any failure throws before the
 * draft is touched (spec 9).
 */
import { t } from "../i18n";
import { AiConfig, AiError, AiStopped, ChatMessage, chatBody, streamChat, Usage } from "./ai";
import { parseBlock, visibleText } from "./block";
import { chapterEnded, loadStoryContext } from "./chapters";
import { listCharacters } from "./characters";
import { writeAiLog } from "./devlog";
import { addVersion, appendBlock, BlockVersion, chapterTexts, chosenVersion, Draft, loadDraft, saveDraft } from "./draft";
import { Values } from "./fields";
import { chapterProgress } from "./length";
import { buildPrompt } from "./prompt";
import { getApiKey } from "./secrets";
import { loadNotes, loadSetting } from "./setting";
import { AppSettings, loadSettings } from "./settings";
import { Story, updateStory } from "./stories";
import { getStoryType, hasSuggestions } from "./storyTypes";
import { callTokens, formatTokens, Tokens } from "./tokens";

/** The global AI settings and the key, or a plain-words error saying what is missing. */
export async function loadAiConfig(): Promise<{ settings: AppSettings; config: AiConfig & { model: string } }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new AiError(t("error.noKey"));
  const settings = await loadSettings();
  return { settings, config: { baseUrl: settings.baseUrl, apiKey, model: settings.model } };
}

export interface LoggedCall<T> {
  storyId: string;
  /** For the log file name, e.g. "block". */
  kind: string;
  settings: AppSettings;
  config: AiConfig & { model: string };
  messages: ChatMessage[];
  /** Shown at the top of the log entry. */
  facts: Record<string, string>;
  signal?: AbortSignal;
  onText?: (raw: string) => void;
  /** Reads the answer; throws when it is unusable. Its facts are added to the log. */
  read: (raw: string) => { value: T; facts: Record<string, string> };
}

/** One AI call, streamed, with its outcome saved to the development log (decision 46), and the tokens it used (spec 6.6). */
export async function loggedCall<T>(call: LoggedCall<T>): Promise<{ value: T; tokens: Tokens }> {
  const startedAt = new Date();
  let received = "";
  let usage: Usage | null = null;
  // The body that went out last: without stream_options after a provider rejected it (decision 87).
  let body = chatBody(call.settings.model, call.messages);
  const log = (outcome: "ok" | "error" | "stopped", error?: string, facts: Record<string, string> = {}) =>
    writeAiLog(call.storyId, {
      kind: call.kind,
      outcome,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      baseUrl: call.settings.baseUrl,
      body,
      facts: { ...call.facts, ...facts },
      response: received,
      error,
    });

  let result: { value: T; facts: Record<string, string> };
  try {
    received = await streamChat({
      config: call.config,
      messages: call.messages,
      signal: call.signal,
      onText: (text) => {
        received = text;
        call.onText?.(text);
      },
      onUsage: (u) => {
        usage = u;
      },
      onRequest: (sent) => {
        body = sent;
      },
    });
    result = call.read(received);
  } catch (e) {
    if (e instanceof AiStopped) await log("stopped");
    else await log("error", e instanceof Error ? e.message : String(e));
    throw e;
  }
  const tokens = callTokens(usage, call.messages, received);
  await log("ok", undefined, { ...result.facts, Tokens: formatTokens(tokens) });
  return { value: result.value, tokens };
}

/**
 * Whether a death the AI wrote can be accepted. Under "Never" the AI was told the
 * main character survives, so a death it wrote anyway can only be regenerated
 * (spec 5.5, decision 62).
 */
export function deathCanBeAccepted(setting: Values): boolean {
  return String(setting.main_character_death ?? "").trim() !== "Never";
}

/**
 * Why no new block can be written now, or null when one can. Regenerating the
 * latest block is always allowed.
 */
export function nextBlockBlocked(draft: Draft, setting: Values): string | null {
  const latest = draft.blocks.at(-1);
  if (!latest) return null;
  if (draft.epilogue) return t("error.epilogueWritten");
  if (chosenVersion(latest).died) {
    return deathCanBeAccepted(setting) ? t("error.died") : t("error.diedNever");
  }
  // Decision 49: the block written at the hard limit concludes the chapter.
  const before = chapterTexts(draft).slice(0, -1);
  const { stage } = chapterProgress(before, String(setting.chapter_length ?? ""), String(setting.language ?? ""));
  if (stage === "hard") return t("error.lengthLimit");
  return null;
}

export interface WriteBlockOptions {
  story: Story;
  draft: Draft;
  /** Writes a new block with this direction. Ignored when regenerating. */
  direction?: string;
  /** Rewrites the latest block instead, with an optional hint (spec 5.2). */
  regenerate?: { hint: string };
  signal?: AbortSignal;
  /** Called with the story text that can be shown so far. */
  onText?: (text: string) => void;
}

/** Writes the next block (or the epilogue), or a new version of the latest one, and returns the saved draft. */
export async function writeBlock(options: WriteBlockOptions): Promise<Draft> {
  const { story, draft, regenerate } = options;
  const latest = draft.blocks.at(-1);
  if (regenerate && !latest) throw new Error(t("error.noBlockToRegenerate"));

  // An ended chapter is read-only (spec 5.4), even while its review is open.
  if (!draft.epilogue && (await chapterEnded(story.id, draft.chapter))) {
    throw new Error(t("error.chapterEnded", { n: String(draft.chapter) }));
  }
  // A page showing an older draft must never write over blocks saved since (decision 91).
  const onDisk = await loadDraft(story);
  const latestOnDisk = onDisk.blocks.at(-1);
  if (
    onDisk.chapter === draft.chapter &&
    (onDisk.blocks.length > draft.blocks.length ||
      (onDisk.blocks.length === draft.blocks.length && (latestOnDisk?.versions.length ?? 0) > (latest?.versions.length ?? 0)))
  ) {
    throw new Error(t("error.draftChanged"));
  }
  const setting = await loadSetting(story);
  if (!regenerate) {
    const blocked = nextBlockBlocked(draft, setting.values);
    if (blocked) throw new Error(blocked);
  }
  const { settings, config } = await loadAiConfig();

  const blocks = chapterTexts(draft);
  const direction = regenerate ? (latest?.direction ?? "") : (options.direction ?? "").trim();
  const hint = regenerate?.hint.trim() ?? "";
  const storyType = getStoryType(story.type);
  // Decision 126: without suggestions, every block (but the epilogue) starts from the user's direction.
  const noActions = !!draft.epilogue || !hasSuggestions(storyType);
  if (!regenerate && !draft.epilogue && !hasSuggestions(storyType) && !direction) {
    throw new Error(t("error.directionRequired"));
  }
  const context = await loadStoryContext(story.id, draft.chapter);
  const prompt = buildPrompt({
    storyType,
    setting,
    notes: await loadNotes(story.id),
    characters: (await listCharacters(story)).characters,
    budget: settings.contextBudget,
    chapter: draft.chapter,
    blocks: regenerate ? blocks.slice(0, -1) : blocks,
    direction,
    hint,
    ...context,
    epilogue: draft.epilogue ? { mainCharacterDied: story.ending === "death" } : undefined,
    // Spec 14.2: only Rich asks the AI for a picture line.
    pictures: settings.images === "rich",
  });

  const progress = chapterProgress(
    regenerate ? blocks.slice(0, -1) : blocks,
    String(setting.values.chapter_length ?? ""),
    String(setting.values.language ?? ""),
  );
  const { value: parsed, tokens } = await loggedCall({
    storyId: story.id,
    kind: (draft.epilogue ? "epilogue" : "block") + (regenerate ? "-regenerate" : ""),
    settings,
    config,
    messages: prompt.messages,
    signal: options.signal,
    onText: (raw) => options.onText?.(visibleText(raw)),
    facts: {
      "Story type": story.type,
      Chapter: String(draft.chapter),
      "Context budget": settings.contextBudget,
      "Prompt layers": prompt.layers.join(", "),
      "Characters in the scene": prompt.scene.join(", ") || "(none)",
      "Chapter length setting": String(setting.values.chapter_length ?? ""),
      "Chapter so far": `${progress.count} of ${progress.limits.target} ${progress.limits.unit} (${progress.stage})`,
      "Story length setting": String(setting.values.story_length ?? ""),
      Direction: direction || "(none)",
      Hint: hint || "(none)",
    },
    read: (raw) => {
      const block = parseBlock(raw);
      if (!block.text) throw new AiError(t("error.emptyBlock"));
      return {
        value: block,
        facts: {
          "Answer format complete": block.complete ? "yes" : "no (no === NEXT === line)",
          "Suggested actions": block.actions.map((a, i) => (block.notes[i] ? `${a} (${block.notes[i]})` : a)).join(" | ") || "(none)",
          "Main character died": block.died ? "yes" : "no",
          Mood: block.mood ?? "none",
          ...(settings.images === "rich" ? { Picture: block.picture ?? "(none)" } : {}),
        },
      };
    },
  });

  const version: BlockVersion = {
    text: parsed.text,
    // The epilogue ends the story: it has no next actions and no death to pause on.
    // A type without suggestions shows none, even if the AI sent some (decision 125).
    actions: noActions ? [] : parsed.actions,
    notes: noActions ? [] : parsed.notes,
    died: draft.epilogue ? false : parsed.died,
    hint,
    createdAt: new Date().toISOString(),
    tokens,
  };
  // Music for this block (spec 13); the epilogue may ask for a happy or sad close too.
  if (parsed.mood) version.mood = parsed.mood;
  // The page asks for the picture once the draft is saved (spec 14.3); writing never waits for it.
  if (parsed.picture && settings.images === "rich") version.picture = parsed.picture;

  const next = regenerate ? addVersion(draft, version) : appendBlock(draft, direction, version);
  await saveDraft(story.id, next);
  // Keeps the story being written at the top of the story list.
  await updateStory(story.id, {});
  return next;
}
