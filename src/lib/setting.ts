/**
 * The story's world setting (setting.md) and pinned story notes (notes.md).
 *
 * setting.md has the form fields in its YAML header and the world's
 * background summary as its body. notes.md is a plain markdown list.
 */
import { t } from "../i18n";
import { formatMarkDoc, parseMarkDoc } from "./markdoc";
import { defaultValues, headerFromValues, normalize, Rank, Values, valuesFromHeader } from "./fields";
import { store } from "./storage";
import { getStory, Story, storyDir, updateStory } from "./stories";
import { getStoryType, settingFields } from "./storyTypes";
import { getSet, setBackground, setValues } from "./curatedSets";

export interface SettingDoc {
  values: Values;
  /** The world's background summary: the file's body. */
  background: string;
  /** Header keys the form does not know; written back unchanged. */
  extra: Record<string, unknown>;
  /** False when setting.md does not exist yet and these are the defaults. */
  saved: boolean;
  /** The curated set these values came from (spec 8); saved to story.json with the setting. */
  setId?: string;
}

const settingPath = (storyId: string) => `${storyDir(storyId)}/setting.md`;
const notesPath = (storyId: string) => `${storyDir(storyId)}/notes.md`;

export async function loadSetting(story: Story): Promise<SettingDoc> {
  const type = getStoryType(story.type);
  const fields = settingFields(type);
  const set = getSet(type.id, story.setId);
  if (!(await store.exists(settingPath(story.id)))) {
    // Every field starts with a default, so a new setting can be saved as it is (decision 44);
    // the story's curated set fills the rest, in the novel's language (decision 85).
    const fromSet = set ? setValues(set, story.language) : {};
    return {
      values: { ...defaultValues(fields), ...fromSet, language: story.language },
      background: set ? setBackground(set, story.language) : "",
      extra: {},
      saved: false,
      setId: set?.id,
    };
  }
  const doc = parseMarkDoc(await store.readText(settingPath(story.id)));
  const { values, extra } = valuesFromHeader(fields, doc.header);
  if (!values.language) values.language = story.language;
  return { values, background: doc.body, extra, saved: true, setId: set?.id };
}

/**
 * Saves setting.md. The novel's language is also kept in story.json, so it is
 * updated there too, with the curated set the values came from.
 */
export async function saveSetting(story: Story, doc: SettingDoc): Promise<Story> {
  const fields = settingFields(getStoryType(story.type));
  const values = normalize(fields, doc.values);
  // Decision 89: a started story keeps its language. Read from disk, so a stale form cannot change it.
  const current = await getStory(story.id);
  if (values.language && values.language !== current.language && (await hasStarted(current))) {
    throw new Error(t("error.languageFixed"));
  }
  const header = headerFromValues(fields, values, new Set(), doc.extra);
  await store.writeText(settingPath(story.id), formatMarkDoc({ header, body: doc.background }));
  const language = String(values.language || story.language);
  return updateStory(story.id, doc.setId ? { language, setId: doc.setId } : { language });
}

export function ladderOf(values: Values): Rank[] {
  return Array.isArray(values.rank_ladder) ? (values.rank_ladder as Rank[]) : [];
}

/**
 * True once the story has started (decision 89): a chapter has ended, or the
 * chapter in progress has a block. From then on the novel's language is
 * fixed and Randomize is not offered. The page also counts the first block
 * while it is still being written, as it does for the lock (decision 61).
 */
export async function hasStarted(story: Story): Promise<boolean> {
  return story.chapterCount > 0 || (await isSettingLocked(story.id));
}

/**
 * The setting is locked from the first block of a chapter until End Chapter
 * (spec 8.1): while draft/draft.json (see draft.ts) has blocks.
 */
export async function isSettingLocked(storyId: string): Promise<boolean> {
  const path = `${storyDir(storyId)}/draft/draft.json`;
  if (!(await store.exists(path))) return false;
  try {
    const draft = JSON.parse(await store.readText(path)) as { blocks?: unknown[] };
    return (draft.blocks?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function loadNotes(storyId: string): Promise<string[]> {
  if (!(await store.exists(notesPath(storyId)))) return [];
  const text = await store.readText(notesPath(storyId));
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

export async function saveNotes(storyId: string, notes: string[]): Promise<void> {
  const lines = notes.map((n) => n.trim()).filter(Boolean);
  await store.writeText(notesPath(storyId), lines.map((n) => `- ${n}`).join("\n") + "\n");
}
