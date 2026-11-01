/**
 * The chapter in progress: stories/<id>/draft/draft.json (spec 3, 5.1, 5.2).
 *
 * The functions that change a draft are pure and return a new one; the page
 * saves it with saveDraft. A draft only changes when a block has arrived in
 * full (decision 38), so a failed or stopped block leaves the file as it was.
 *
 * setting.ts reads `blocks.length` from the same file to lock the setting
 * (spec 8.1), so keep `blocks` at the top level.
 */
import { t } from "../i18n";
import { hasMarker, parseBlock, stripFlagLines } from "./block";
import { Mood, readMood } from "./mood";
import { store } from "./storage";
import { Story, StoryEnding, storyDir } from "./stories";
import { addTokens, readTokens, Tokens } from "./tokens";

export interface BlockVersion {
  text: string;
  /** Suggested next actions; empty when the AI sent none (decision 37). */
  actions: string[];
  /** A note per action on what it might do; missing in blocks written before decision 86. */
  notes?: string[];
  /** The AI says the main character died in this version (spec 5.5). Handled in phase 4. */
  died: boolean;
  /** The regenerate hint that produced this version; empty for the first one. */
  hint: string;
  createdAt: string;
  /** The tokens this version used (spec 6.6); missing in blocks written before phase 6. */
  tokens?: Tokens;
  /** The music this version asked for (spec 13); missing for no music and in blocks written before phase 8. */
  mood?: Mood;
  /**
   * The scene for this version's picture, from the AI's picture line (spec 14.2); missing when
   * there was none. The picture itself is a file named after createdAt (pictures.ts).
   */
  picture?: string;
}

export interface DraftBlock {
  /** The user's direction for this block; empty for an undirected first block. */
  direction: string;
  /** Every version of the block. Only the latest block keeps more than one (decision 39). */
  versions: BlockVersion[];
  /** Index of the version that counts. */
  chosen: number;
}

export interface Draft {
  chapter: number;
  blocks: DraftBlock[];
  /** True for the story's epilogue: one block, regenerated as versions (decision 52). */
  epilogue?: true;
  /**
   * The ending accepted at End Chapter (spec 5.5). Saved before chapter.md, so
   * reconcileStory can still copy it to story.json if that write fails (decision 75).
   */
  ending?: StoryEnding;
  /** Every successful block call of the chapter, dropped versions included (spec 6.6). */
  tokens?: Tokens;
}

export const draftPath = (storyId: string) => `${storyDir(storyId)}/draft/draft.json`;

/** An empty draft for the next chapter, or for the epilogue once the story is ending (spec 5.5). */
export function emptyDraft(story: Story): Draft {
  const draft: Draft = { chapter: story.chapterCount + 1, blocks: [] };
  if (story.ending) draft.epilogue = true;
  return draft;
}

/** Tidies a draft read from disk, which may have been edited by hand. */
function normalizeDraft(raw: unknown, fallbackChapter: number): Draft {
  const obj = (raw ?? {}) as Partial<Draft>;
  const blocks = (Array.isArray(obj.blocks) ? obj.blocks : [])
    .map((b): DraftBlock | null => {
      const versions = (Array.isArray(b?.versions) ? b.versions : [])
        .filter((v) => v && typeof v.text === "string")
        .map((v) => {
          // Actions and notes are tidied as pairs, so a dropped action takes its note with it (CR6-08).
          const raw = Array.isArray(v.actions) ? v.actions : [];
          const kept = raw.map((a, i) => ({ a, i })).filter((x): x is { a: string; i: number } => typeof x.a === "string");
          const version: BlockVersion = {
            // Blocks saved before decision 54 may still hold a flag line.
            text: stripFlagLines(v.text),
            actions: kept.map((x) => x.a),
            died: v.died === true,
            hint: typeof v.hint === "string" ? v.hint : "",
            createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
          };
          if (Array.isArray(v.notes)) {
            const notes: unknown[] = v.notes;
            version.notes = kept.map((x) => (typeof notes[x.i] === "string" ? (notes[x.i] as string) : ""));
          }
          // A block saved before decision 90 may hold the marker and its suggestions in its text.
          if (hasMarker(version.text)) {
            const parsed = parseBlock(version.text);
            version.text = parsed.text;
            if (version.actions.length === 0) {
              version.actions = parsed.actions;
              version.notes = parsed.notes;
            }
            version.died = version.died || parsed.died;
          }
          const tokens = readTokens(v.tokens);
          if (tokens) version.tokens = tokens;
          const mood = readMood(v.mood);
          if (mood) version.mood = mood;
          if (typeof v.picture === "string" && v.picture.trim()) version.picture = v.picture.trim();
          return version;
        });
      if (versions.length === 0) return null;
      const chosen = Number.isInteger(b.chosen) && b.chosen >= 0 && b.chosen < versions.length ? b.chosen : versions.length - 1;
      return { direction: typeof b.direction === "string" ? b.direction : "", versions, chosen };
    })
    .filter((b): b is DraftBlock => b !== null);
  const chapter = Number.isInteger(obj.chapter) && (obj.chapter as number) > 0 ? (obj.chapter as number) : fallbackChapter;
  const draft: Draft = obj.epilogue === true ? { chapter, blocks, epilogue: true } : { chapter, blocks };
  if (obj.ending === "death" || obj.ending === "choice") draft.ending = obj.ending;
  const tokens = readTokens(obj.tokens);
  if (tokens) draft.tokens = tokens;
  return draft;
}

/** The draft of the story, or an empty one for the next chapter. Throws a readable error for a corrupt file. */
export async function loadDraft(story: Story): Promise<Draft> {
  const path = draftPath(story.id);
  if (!(await store.exists(path))) return emptyDraft(story);
  let raw: unknown;
  try {
    raw = JSON.parse(await store.readText(path));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(t("error.draftCorrupt", { detail: reason }));
  }
  return normalizeDraft(raw, story.chapterCount + 1);
}

/** Clears the draft once its chapter is finished (spec 5.4 step 4). */
export async function deleteDraft(storyId: string): Promise<void> {
  await store.remove(draftPath(storyId));
}

export async function saveDraft(storyId: string, draft: Draft): Promise<void> {
  await store.writeText(draftPath(storyId), JSON.stringify(draft, null, 2));
}

export function chosenVersion(block: DraftBlock): BlockVersion {
  return block.versions[block.chosen];
}

/** The chosen text of every block, in order: the chapter so far. */
export function chapterTexts(draft: Draft): string[] {
  return draft.blocks.map((b) => chosenVersion(b).text);
}

/**
 * Adds the next block. The block before it keeps only its chosen version,
 * which is now fixed (spec 5.2, decision 39).
 */
export function appendBlock(draft: Draft, direction: string, version: BlockVersion): Draft {
  const fixed = draft.blocks.map((b) => (b.versions.length > 1 ? { ...b, versions: [chosenVersion(b)], chosen: 0 } : b));
  return withTokens({ ...draft, blocks: [...fixed, { direction: direction.trim(), versions: [version], chosen: 0 }] }, version);
}

/** Adds a new version's tokens to the chapter's total, which keeps them after the version is dropped (spec 6.6). */
function withTokens(draft: Draft, version: BlockVersion): Draft {
  const tokens = addTokens(draft.tokens, version.tokens);
  return tokens ? { ...draft, tokens } : draft;
}

function withLatest(draft: Draft, change: (block: DraftBlock) => DraftBlock): Draft {
  const latest = draft.blocks.at(-1);
  if (!latest) throw new Error(t("error.noBlockToChange"));
  return { ...draft, blocks: [...draft.blocks.slice(0, -1), change(latest)] };
}

/** Adds a regenerated version of the latest block and chooses it. Earlier versions are kept (spec 5.2). */
export function addVersion(draft: Draft, version: BlockVersion): Draft {
  return withTokens(
    withLatest(draft, (b) => ({ ...b, versions: [...b.versions, version], chosen: b.versions.length })),
    version,
  );
}

/** Switches the latest block to one of its versions. Only the latest block has versions to switch (spec 5.2). */
export function chooseVersion(draft: Draft, index: number): Draft {
  return withLatest(draft, (b) => {
    if (!Number.isInteger(index) || index < 0 || index >= b.versions.length) {
      throw new Error(t("error.noVersion"));
    }
    return { ...b, chosen: index };
  });
}
