/**
 * End Chapter (spec 5.4) and the story's ending (spec 5.5).
 *
 * Every step keeps its result in files (decision 50), so closing the app at
 * any point loses nothing:
 *   1. endChapter: the ending (if any) goes into the draft, then chapter.md is
 *      written; the chapter is now ended. Then story.json is updated.
 *   2. summarizeChapter: one AI call; the proposals (review.json), the used
 *      scenes list, the new "story so far", and last the chapter's summary.md
 *      (title, summary and next chapter's openings) are saved as soon as it
 *      answers. summary.md marks the step done, so it is written last
 *      (decision 76). If it fails, retry with summarizeChapter. Only one call
 *      per story runs at a time (decision 77).
 *   3. The user answers each proposal; approving writes it at once.
 *   4. finishChapter: snapshot, then the draft is deleted.
 *
 * story.json is not the marker of any step: reconcileStory rebuilds its
 * chapterCount and ending from the files above, so a failed story.json write
 * never blocks the story (decision 75).
 */
import { Locale, novelLocale, optionLabel, t } from "../i18n";
import { AiError, ChatMessage } from "./ai";
import {
  ChapterSummary,
  chapterDir,
  chapterEnded,
  defaultTitle,
  readChapterSummary,
  readStorySummary,
  readUsedScenes,
  saveChapterSummary,
  saveChapterText,
  saveStorySummary,
  saveUsedScenes,
  snapshotChapter,
} from "./chapters";
import { Character, characterName, hiddenKeys, listCharacters, requiredKeys, saveCharacter } from "./characters";
import { chapterTexts, deleteDraft, Draft, loadDraft, saveDraft } from "./draft";
import { choiceToEnglish, coerce, FieldDef, localizeChoices, normalize, pickOptionsFor, rankOptions, Values, valuesFromHeader, validate } from "./fields";
import { estimateTokens, tokensToLength } from "./length";
import { addTokens } from "./tokens";
import { formatMarkDoc } from "./markdoc";
import { deathCanBeAccepted, loadAiConfig, loggedCall } from "./novel";
import { drawChapterPicture, keepChapterPictures } from "./pictures";
import { BUDGETS } from "./prompt";
import { ladderOf, loadSetting } from "./setting";
import { getStory, Story, StoryEnding, updateStory } from "./stories";
import { characterFields, getStoryType, hasSuggestions, StoryType } from "./storyTypes";
import { readJson, store, writeJson } from "./storage";

// ---------- review.json ----------

export type ProposalStatus = "pending" | "approved" | "rejected";

/** A change to one field of an existing character (spec 7.5). */
export interface ChangeProposal {
  id: string;
  kind: "change";
  characterId: string;
  characterName: string;
  field: string;
  label: string;
  /** Read from the character file, not from the AI (decision 51). */
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  status: ProposalStatus;
}

/** A pre-filled file for a character the chapter introduced (spec 7.5). */
export interface NewCharacterProposal {
  id: string;
  kind: "new";
  name: string;
  values: Values;
  background: string;
  reason: string;
  /** Set when the app filled in the age (decision 67): the AI gave none, or one below the minimum. */
  ageFilled?: "missing" | "too-low";
  status: ProposalStatus;
}

export type Proposal = ChangeProposal | NewCharacterProposal;

export interface Review {
  chapter: number;
  proposals: Proposal[];
}

const reviewPath = (storyId: string, n: number) => `${chapterDir(storyId, n)}/review.json`;

export async function loadReview(storyId: string, n: number): Promise<Review> {
  if (!(await store.exists(reviewPath(storyId, n)))) return { chapter: n, proposals: [] };
  return readJson<Review>(reviewPath(storyId, n));
}

async function saveReview(storyId: string, review: Review): Promise<void> {
  await writeJson(reviewPath(storyId, review.chapter), review);
}

/** The review is finished when every proposal has an answer. */
export function reviewDone(review: Review): boolean {
  return review.proposals.every((p) => p.status !== "pending");
}

/** A field value as the user reads it, choices in the UI language (spec 11). */
export function formatValue(value: unknown, field?: FieldDef): string {
  const show = (v: unknown) => (typeof v !== "string" ? JSON.stringify(v) : field?.options ? optionLabel(field, v) : v);
  if (value === null || value === undefined || value === "") return t("common.empty");
  if (Array.isArray(value)) return value.length ? value.map(show).join(", ") : t("common.empty");
  return typeof value === "string" ? show(value) : String(value);
}

// ---------- the End Chapter call ----------

/** The AI's answer, before the proposals are checked. */
export interface EndChapterAnswer {
  title: string;
  chapterSummary: string;
  storySummary: string;
  /** The whole updated used scenes list (spec 6.4); empty when the AI left it out. */
  scenes: string[];
  /** Two or three ways the next chapter could open (decision 65). */
  nextOpenings: string[];
  /** The chapter's key scene for its Lite picture (spec 14.2); empty when not asked for or left out. */
  picture: string;
  changes: { character: string; field: string; newValue: unknown; reason: string }[];
  newCharacters: { name: string; fields: Record<string, unknown>; background: string; reason: string }[];
}

const UNREADABLE = () => t("error.summaryUnreadable");

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Reads the JSON answer; tolerates a code fence or text around the object (decision 51). */
export function parseEndChapter(raw: string): EndChapterAnswer {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new AiError(UNREADABLE());
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new AiError(UNREADABLE());
  }
  const chapterSummary = str(obj.chapter_summary);
  const storySummary = str(obj.story_summary);
  if (!chapterSummary || !storySummary) {
    throw new AiError(t("error.summaryMissing"));
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []) as Record<string, unknown>[];
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  return {
    title: str(obj.title),
    chapterSummary,
    storySummary,
    scenes: strings(obj.scenes),
    nextOpenings: strings(obj.next_openings).slice(0, 3),
    picture: str(obj.picture),
    changes: list(obj.character_changes).map((c) => ({
      character: str(c.character),
      field: str(c.field),
      newValue: c.new_value,
      reason: str(c.reason),
    })),
    newCharacters: list(obj.new_characters).map((c) => ({
      name: str(c.name),
      fields: c.fields && typeof c.fields === "object" ? (c.fields as Record<string, unknown>) : {},
      background: str(c.background),
      reason: str(c.reason),
    })),
  };
}

/** Allowed values are listed in the novel's language, as the characters are sent (decision 84). */
function describeField(f: FieldDef, locale: Locale, ranks: string[], picks: Record<string, string[]>): string {
  const options = f.options?.map((o) => optionLabel(f, o, locale)).join(", ");
  switch (f.type) {
    case "choice":
      // Decision 105: "Other" means typing the class itself.
      return f.otherOption
        ? `${f.key}: one of ${f.options!.filter((o) => o !== f.otherOption).map((o) => optionLabel(f, o, locale)).join(", ")}, or another one written out`
        : `${f.key}: one of ${options}`;
    case "pick": {
      // The setting's own list, in the story's language (decisions 101, 104).
      const list = picks[f.key] ?? [];
      return list.length ? `${f.key}: one of ${list.join(" | ")}` : `${f.key}: text`;
    }
    case "multi":
      return `${f.key}: a list of up to ${f.max ?? "any number of"} of ${options}`;
    case "list":
      return `${f.key}: a list of short strings`;
    case "number":
      return `${f.key}: a number`;
    case "scale":
      return `${f.key}: a number from ${f.min ?? 1} to ${f.max ?? 5}`;
    case "rank":
      // The story's own ladder, in its language; an English example made Chinese stories answer in English (CR6-02).
      return ranks.length
        ? `${f.key}: one of the ranks in the setting's rank ladder: ${ranks.join(" | ")}`
        : `${f.key}: one of the ranks in the setting's rank ladder`;
    default:
      return `${f.key}: text`;
  }
}

export interface EndChapterPromptInput {
  type: StoryType;
  language: string;
  chapter: number;
  chapterText: string;
  storySummary: string;
  characters: Character[];
  /** The "story so far" cap in tokens, from the context budget (spec 6.2). */
  storySummaryTokens: number;
  /** The used scenes list before this chapter (spec 6.4). */
  usedScenes: string[];
  /** Its cap in tokens, from the context budget (spec 6.2). */
  usedScenesTokens: number;
  /** Every rank and stage of the setting's ladder, for a rank field. */
  ranks?: string[];
  /** The options of each pick field, from the setting's lists (pickOptionsFor). */
  picks?: Record<string, string[]>;
  /** Asks for the chapter's key scene too: images are on Lite (spec 14.2). */
  picture?: boolean;
}

export function buildEndChapterPrompt(input: EndChapterPromptInput): ChatMessage[] {
  const cap = tokensToLength(input.storySummaryTokens, input.language);
  const overCap = estimateTokens(input.storySummary, input.language) > input.storySummaryTokens;
  const scenesCap = tokensToLength(input.usedScenesTokens, input.language);
  const scenesOverCap = estimateTokens(input.usedScenes.join("\n"), input.language) > input.usedScenesTokens;
  const { minAge } = input.type.rules;
  // Decision 104: with no adventurer ranks, the rank is not a field the AI can fill (CR-01).
  const fields = characterFields(input.type).filter((f) => !(f.hideWhenEmpty && input.picks && !input.picks[f.key]?.length));
  const locale = novelLocale(input.language) ?? "en";
  // Decision 125: a type without suggestions asks for no openings for the next chapter.
  const suggests = hasSuggestions(input.type);
  const system = [
    `You are the editor of an interactive ${input.type.name.toLowerCase()} novel. Chapter ${input.chapter} has just ended. Read it and answer with one JSON object and nothing else, in this shape:`,
    `{"title": "...", "chapter_summary": "...", "story_summary": "...", "scenes": ["..."], ${suggests ? '"next_openings": ["..."], ' : ""}${input.picture ? '"picture": "...", ' : ""}"character_changes": [{"character": "...", "field": "...", "new_value": ..., "reason": "..."}], "new_characters": [{"name": "...", "fields": {"field": "value"}, "background": "...", "reason": "..."}]}`,
    [
      `- title: a short chapter title in ${input.language}.`,
      `- chapter_summary: about 150 words in ${input.language}: what happened in this chapter.`,
      `- story_summary: the whole story so far, this chapter included, in ${input.language}, at most ${cap.amount} ${cap.unit}.` +
        (overCap
          ? " The current summary is longer than that: compress the oldest events into short arc-level lines (spec 6.1)."
          : ""),
      `- scenes: the whole updated list of scene types and turning points the story has used, the list below plus this chapter's, one short line each in ${input.language}, such as "rival humiliates the main character in public". Name the kind of scene, not its details. At most ${scenesCap.amount} ${scenesCap.unit} in all.` +
        (scenesOverCap ? " The current list is longer than that: merge similar lines into broader ones." : ""),
      suggests &&
        `- next_openings: two or three short, different ways the next chapter could open, in ${input.language}, each saying what the main character does next, starting with their name or the action, never phrased as a request (no "Have …", "請…" or "讓…"). Write them as a native ${input.language} speaker would. None of them may stage a scene from the scenes list again.`,
      // Spec 14.2: the scene for the chapter's Lite picture, in English for the image model.
      input.picture &&
        "- picture: one or two sentences in English describing the chapter's most striking moment as a picture: who is there (by their names as written in the story), where, what is happening, the light and the mood. Describe only what can be seen; no dialogue, no text. Keep it non-explicit.",
      "- character_changes: only changes this chapter clearly shows, for the characters listed below. \"field\" is one of the field keys listed below. For a list field give the whole new list. Never change a name. Use an empty list when nothing changed.",
      // Decision 138: a new value replaces the old one, so lasting facts must be carried over (QA-04).
      "- new_value replaces the field's old value completely. Keep everything in the old value that is still true and drop only what this chapter shows has ended. A lasting mark, scar, illness or curse stays in the condition when a new wound is added.",
      `- new_characters: named characters who appear in this chapter, matter to the story and have no character file yet. Fill in the fields you know, and always give an age: your best guess from the chapter${minAge !== undefined ? `, at least ${minAge}` : ""}. Use an empty list when there are none.`,
      // Decision 145: pictures need to know how each character looks.
      `- appearance: give every new character one, in ${input.language}: a short description of how they look (face, hair, build, usual clothes), from the chapter or a fitting guess. For a listed character whose appearance is empty, propose one only when the chapter shows how they look.`,
      "- reason: one short line saying what in the chapter caused the change.",
      "Write the JSON keys in English.",
    ]
      .filter(Boolean)
      .join("\n"),
  ].join("\n\n");

  const characterFiles = input.characters.map((c) => {
    const header = valuesHeader(fields, { ...c, values: localizeChoices(fields, c.values, locale) });
    return `### ${characterName(c)}${c.isMain ? " (main character)" : ""}\n${formatMarkDoc({ header, body: "" }).trim()}`;
  });
  const user = [
    `## Character fields\n${fields.filter((f) => f.key !== "name").map((f) => `- ${describeField(f, locale, input.ranks ?? [], input.picks ?? {})}`).join("\n")}`,
    `## Characters\n${characterFiles.join("\n\n") || "(none)"}`,
    `## The story so far, before this chapter\n${input.storySummary || "(This is the first chapter.)"}`,
    `## Scenes the story has already used\n${input.usedScenes.map((l) => `- ${l}`).join("\n") || "(none yet)"}`,
    `## Chapter ${input.chapter}\n${input.chapterText}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function valuesHeader(fields: FieldDef[], c: Character): Record<string, unknown> {
  const hidden = hiddenKeys(fields, c.isMain);
  return Object.fromEntries(fields.filter((f) => !hidden.has(f.key)).map((f) => [f.key, c.values[f.key] ?? null]));
}

/**
 * Turns the AI's proposals into ones the user can approve. Unknown characters
 * or fields, values the field does not allow, and "changes" to the current
 * value are dropped (decision 51).
 */
export function checkProposals(
  answer: EndChapterAnswer,
  characters: Character[],
  type: StoryType,
  ranks: string[],
  /** The setting's lists for pick fields (pickOptionsFor): a race or rank must be one of them. */
  picks: Record<string, string[]> = {},
): Proposal[] {
  const fields = characterFields(type);
  const out: Proposal[] = [];
  const byName = (name: string) =>
    characters.find((c) => characterName(c).toLowerCase() === name.toLowerCase() && c.values.name);

  for (const change of answer.changes) {
    const character = byName(change.character);
    const field = fields.find((f) => f.key === change.field && f.key !== "name");
    if (!character || !field || hiddenKeys(fields, character.isMain).has(field.key)) continue;
    // A rank in a story whose ranks are turned off (decision 104, CR-01).
    if (field.hideWhenEmpty && !picks[field.key]?.length) continue;
    // A choice may come back in the novel's language; files keep English (decision 84).
    const value = normalize([field], { [field.key]: coerce(field, choiceToEnglish(field, change.newValue)) })[field.key];
    // Emptying a list (an inventory used up) is a real change; emptying a field the
    // character must have, such as the main character's class, is not (CR-03).
    const required = requiredKeys(type, fields, character.isMain);
    const listLike = field.type === "list" || field.type === "multi";
    const errors = validate([field], { [field.key]: value }, {
      required: required.has(field.key) && !listLike ? new Set([field.key]) : new Set(),
      hidden: new Set(),
      rankOptions: ranks,
      pickOptions: picks,
      minAge: type.rules.minAge,
    });
    if (errors[field.key]) continue;
    const current = normalize([field], { [field.key]: character.values[field.key] })[field.key];
    if (JSON.stringify(current) === JSON.stringify(value)) continue;
    out.push({
      id: `change-${out.length + 1}`,
      kind: "change",
      characterId: character.id,
      characterName: characterName(character),
      field: field.key,
      label: field.label,
      oldValue: current,
      newValue: value,
      reason: change.reason,
      status: "pending",
    });
  }

  for (const proposed of answer.newCharacters) {
    if (!proposed.name || byName(proposed.name)) continue;
    const english = Object.fromEntries(
      Object.entries(proposed.fields).map(([k, v]) => {
        const field = fields.find((f) => f.key === k);
        return [k, field ? choiceToEnglish(field, v) : v];
      }),
    );
    const { values } = valuesFromHeader(fields, { ...english, name: proposed.name });
    const normalized = normalize(fields, values);
    // A race or rank outside the setting's lists is left empty rather than refused (CR-01).
    for (const f of fields) {
      if (f.type === "pick" && normalized[f.key] && !(picks[f.key] ?? []).includes(String(normalized[f.key]))) normalized[f.key] = "";
    }
    // Decision 67: the user never has to type an age just to accept a proposal.
    const age = normalized.age;
    const ageFilled =
      typeof age !== "number" ? "missing" : type.rules.minAge !== undefined && age < type.rules.minAge ? "too-low" : undefined;
    if (ageFilled) normalized.age = type.rules.defaultAge;
    out.push({
      id: `new-${out.length + 1}`,
      kind: "new",
      name: proposed.name,
      values: normalized,
      background: proposed.background,
      reason: proposed.reason,
      ...(ageFilled ? { ageFilled } : {}),
      status: "pending",
    });
  }
  return out;
}

/** What End Chapter is doing, for the progress dialog (decision 88). */
export type EndChapterStep = "saving-chapter" | "writing-summary" | "saving-summary";

/**
 * Step 1: saves the chapter's text, and the ending if this chapter ends the
 * story (spec 5.5). Then runs step 2; if that fails, the chapter stays saved
 * and summarizeChapter can be retried.
 */
export async function endChapter(
  story: Story,
  draft: Draft,
  ending?: StoryEnding,
  signal?: AbortSignal,
  onStep?: (step: EndChapterStep) => void,
): Promise<Review> {
  onStep?.("saving-chapter");
  if (draft.epilogue) throw new Error(t("error.epilogueNotEnded"));
  if (draft.blocks.length === 0) throw new Error(t("error.noBlocks"));
  if (ending === "death" && !deathCanBeAccepted((await loadSetting(story)).values)) {
    throw new Error(t("error.deathNever"));
  }
  const n = draft.chapter;
  if (!(await chapterEnded(story.id, n))) {
    // The draft keeps the ending first, so it survives a failed story.json write below.
    // A stale one, from a death that was regenerated away, is cleared the same way.
    if (draft.ending !== ending) {
      const marked: Draft = { ...draft };
      delete marked.ending;
      if (ending) marked.ending = ending;
      await saveDraft(story.id, marked);
    }
    await saveChapterText(story.id, n, chapterTexts(draft).join("\n\n"));
  }
  const updated = await updateStory(story.id, {
    chapterCount: Math.max(story.chapterCount, n),
    ...(ending ? { ending } : {}),
  });
  return summarizeChapter(updated, n, signal, onStep);
}

/**
 * Brings story.json in step with the chapter files (decision 75): chapterCount
 * covers the ended chapter in the draft, and that chapter's ending is copied
 * over. Safe to run at any time; it writes only when something is missing.
 */
export async function reconcileStory(story: Story): Promise<Story> {
  if (story.status === "completed") return story;
  const draft = await loadDraft(story);
  if (draft.epilogue || draft.blocks.length === 0 || !(await chapterEnded(story.id, draft.chapter))) return story;
  const patch: Partial<Story> = {};
  if (story.chapterCount < draft.chapter) patch.chapterCount = draft.chapter;
  if (draft.ending && story.ending !== draft.ending) patch.ending = draft.ending;
  return Object.keys(patch).length ? updateStory(story.id, patch) : story;
}

/** The End Chapter call running for each story, so a Retry cannot start a second one (decision 77). */
const summarizing = new Map<string, Promise<Review>>();

/** The End Chapter call still running for this story, if any; the page waits for it instead of offering Retry. */
export function summaryInFlight(storyId: string): Promise<Review> | undefined {
  return summarizing.get(storyId);
}

/** Step 2: the End Chapter call. Saves its results as soon as it answers. */
export async function summarizeChapter(
  story: Story,
  n: number,
  signal?: AbortSignal,
  onStep?: (step: EndChapterStep) => void,
): Promise<Review> {
  if (summarizing.has(story.id)) {
    throw new Error(t("error.summaryRunning"));
  }
  // Cleared before anyone waiting on the call carries on, so they can retry at once.
  const call = runSummary(story, n, signal, onStep).finally(() => summarizing.delete(story.id));
  summarizing.set(story.id, call);
  return call;
}

async function runSummary(
  story: Story,
  n: number,
  signal?: AbortSignal,
  onStep?: (step: EndChapterStep) => void,
): Promise<Review> {
  const type = getStoryType(story.type);
  const setting = await loadSetting(story);
  const language = String(setting.values.language || story.language);
  const { characters } = await listCharacters(story);
  const { settings, config } = await loadAiConfig();
  const storySummary = await readStorySummary(story.id);
  const usedScenes = await readUsedScenes(story.id);
  const budget = BUDGETS[settings.contextBudget] ?? BUDGETS.balanced;
  const chapterText = (await store.readText(`${chapterDir(story.id, n)}/chapter.md`)).trim();
  const messages = buildEndChapterPrompt({
    type,
    language,
    chapter: n,
    chapterText,
    storySummary,
    characters,
    storySummaryTokens: budget.storySummaryTokens,
    usedScenes,
    usedScenesTokens: budget.usedScenesTokens,
    ranks: rankOptions(ladderOf(setting.values)),
    picks: pickOptionsFor(characterFields(type), setting.values),
    picture: settings.images === "lite",
  });

  onStep?.("writing-summary");
  const { value: answer, tokens } = await loggedCall({
    storyId: story.id,
    kind: "end-chapter",
    settings,
    config,
    messages,
    signal,
    facts: { Chapter: String(n), "Context budget": settings.contextBudget },
    read: (raw) => {
      const a = parseEndChapter(raw);
      return {
        value: a,
        facts: {
          Title: a.title || "(none)",
          "Used scenes": String(a.scenes.length),
          "Next chapter openings": String(a.nextOpenings.length),
          ...(settings.images === "lite" ? { Picture: a.picture || "(none)" } : {}),
          "Proposed changes": String(a.changes.length),
          "New characters": String(a.newCharacters.length),
        },
      };
    },
  });

  onStep?.("saving-summary");
  const proposals = checkProposals(
    answer,
    characters,
    type,
    rankOptions(ladderOf(setting.values)),
    pickOptionsFor(characterFields(type), setting.values),
  );
  const review: Review = { chapter: n, proposals };
  // The chapter's summary.md marks this step done (loadNovelState), so it goes last:
  // a failed write before it leaves the chapter "summary pending" and Retry redoes it all (decision 76).
  await saveReview(story.id, review);
  // An answer without the list keeps the old one rather than wiping it.
  if (answer.scenes.length) await saveUsedScenes(story.id, answer.scenes);
  await saveStorySummary(story.id, answer.storySummary);
  // The chapter's blocks (kept in the draft until Finish) plus this call (spec 6.6).
  const draft = await loadDraft(story);
  const chapterTokens = addTokens(draft.chapter === n ? draft.tokens : undefined, tokens);
  await saveChapterSummary(story.id, n, {
    title: answer.title || defaultTitle(n),
    summary: answer.chapterSummary,
    // Decision 125: no openings in a type without suggestions, even if the AI sent some.
    openings: hasSuggestions(type) ? answer.nextOpenings : [],
    tokens: chapterTokens,
    ...(settings.images === "lite" && answer.picture ? { picture: answer.picture } : {}),
  });
  // Lite: the chapter's picture is drawn in the background; the review never waits for it (spec 14.3).
  if (settings.images === "lite") void drawChapterPicture(story, n);
  return review;
}

async function answer(storyId: string, n: number, id: string, status: ProposalStatus): Promise<Review> {
  const review = await loadReview(storyId, n);
  const proposal = review.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(t("error.noProposal"));
  proposal.status = status;
  await saveReview(storyId, review);
  return review;
}

/** Step 3: writes an approved change, or an accepted new character, to its file at once. */
export async function approveProposal(story: Story, n: number, id: string): Promise<Review> {
  const review = await loadReview(story.id, n);
  const proposal = review.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(t("error.noProposal"));
  // Already answered, e.g. a second Accept after a failed review.json write: nothing more to apply (decision 78).
  if (proposal.status !== "pending") return review;
  const type = getStoryType(story.type);
  const fields = characterFields(type);

  if (proposal.kind === "change") {
    const character = (await listCharacters(story)).characters.find((c) => c.id === proposal.characterId);
    if (!character) throw new Error(t("error.characterGone", { name: proposal.characterName }));
    await saveCharacter(story, { ...character, values: { ...character.values, [proposal.field]: proposal.newValue } });
  } else {
    // The same check checkProposals makes, against the files as they are now (decision 78).
    const { characters } = await listCharacters(story);
    if (characters.some((c) => c.values.name && characterName(c).toLowerCase() === proposal.name.trim().toLowerCase())) {
      throw new Error(t("error.nameExists", { name: proposal.name }));
    }
    const setting = (await loadSetting(story)).values;
    const ranks = rankOptions(ladderOf(setting));
    const errors = validate(fields, proposal.values, {
      required: requiredKeys(type, fields, false),
      hidden: hiddenKeys(fields, false),
      rankOptions: ranks,
      pickOptions: pickOptionsFor(fields, setting),
      minAge: type.rules.minAge,
    });
    if (Object.keys(errors).length > 0) {
      throw new Error(t("error.editFirst", { name: proposal.name, errors: Object.values(errors).join(" ") }));
    }
    await saveCharacter(story, newCharacterFrom(proposal));
  }
  return answer(story.id, n, id, "approved");
}

/** The character a "new character" proposal describes, for saving or for editing in the form first. */
export function newCharacterFrom(proposal: NewCharacterProposal): Character {
  return { id: "", isMain: false, values: { ...proposal.values }, background: proposal.background, extra: {} };
}

export function rejectProposal(storyId: string, n: number, id: string): Promise<Review> {
  return answer(storyId, n, id, "rejected");
}

/** A new character the user edited and saved in the form counts as accepted. */
export function markAccepted(storyId: string, n: number, id: string): Promise<Review> {
  return answer(storyId, n, id, "approved");
}

/** Step 4: snapshot and clear the draft (spec 5.4). Only when the summary exists and every proposal is answered. */
export async function finishChapter(story: Story, n: number): Promise<Story> {
  if (!(await readChapterSummary(story.id, n))) throw new Error(t("error.noSummaryYet"));
  if (!reviewDone(await loadReview(story.id, n))) throw new Error(t("error.answerAll"));
  // Last chance to copy the chapter count and ending from the draft, before it is deleted.
  await reconcileStory(await getStory(story.id));
  await snapshotChapter(story.id, n);
  // Rich pictures move to the chapter with the blocks they belong to (decision 146).
  const draft = await loadDraft(story);
  if (draft.chapter === n) await keepChapterPictures(story.id, draft);
  await deleteDraft(story.id);
  return updateStory(story.id, {});
}

// ---------- where the Novel page stands ----------

export type NovelState =
  /** The story has its epilogue (spec 5.5): readable only. */
  | { kind: "completed" }
  /** Writing a chapter or the epilogue; the draft may be empty (a "Start chapter N" or epilogue screen). */
  | { kind: "writing"; draft: Draft }
  /** The chapter is saved, but the End Chapter call has not succeeded yet (spec 5.4). */
  | { kind: "summary-pending"; draft: Draft }
  /** The summary exists; the user is reviewing the proposed changes. */
  | { kind: "review"; draft: Draft; summary: ChapterSummary; review: Review };

export async function loadNovelState(story: Story): Promise<NovelState> {
  if (story.status === "completed") return { kind: "completed" };
  const draft = await loadDraft(story);
  if (draft.epilogue || draft.blocks.length === 0 || !(await chapterEnded(story.id, draft.chapter))) {
    return { kind: "writing", draft };
  }
  const summary = await readChapterSummary(story.id, draft.chapter);
  if (!summary) return { kind: "summary-pending", draft };
  return { kind: "review", draft, summary, review: await loadReview(story.id, draft.chapter) };
}

// ---------- the story's ending (spec 5.5) ----------

/** "End story": the next step is the epilogue. Only between chapters. */
export async function endStory(story: Story, draft: Draft): Promise<Story> {
  if (draft.blocks.length > 0) throw new Error(t("error.finishChapterFirst"));
  return updateStory(story.id, { ending: "choice" });
}

/** Saves the accepted epilogue as the last chapter and marks the story Completed (decision 52). */
export async function acceptEpilogue(story: Story, draft: Draft): Promise<Story> {
  if (!draft.epilogue || draft.blocks.length === 0) throw new Error(t("error.noEpilogue"));
  const n = draft.chapter;
  if (!(await chapterEnded(story.id, n))) await saveChapterText(story.id, n, chapterTexts(draft).join("\n\n"));
  const summary: ChapterSummary = { title: "Epilogue", summary: "", tokens: draft.tokens };
  await saveChapterSummary(story.id, n, summary);
  await snapshotChapter(story.id, n);
  await keepChapterPictures(story.id, draft);
  await deleteDraft(story.id);
  await updateStory(story.id, { chapterCount: Math.max(story.chapterCount, n), status: "completed" });
  return getStory(story.id);
}
