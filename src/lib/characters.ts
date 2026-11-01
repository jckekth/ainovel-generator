/**
 * Characters: one markdown file each, in stories/<id>/characters/<character-id>.md.
 *
 * The YAML header holds main_character plus the form fields; the body is the
 * character's background summary.
 */
import { t } from "../i18n";
import { formatMarkDoc, parseMarkDoc } from "./markdoc";
import { defaultValues, FieldDef, headerFromValues, normalize, pickOptionsFor, Values, valuesFromHeader } from "./fields";
import { store } from "./storage";
import { makeId, Story, storyDir, updateStory } from "./stories";
import { characterFields, getStoryType, StoryType } from "./storyTypes";
import { getSet, setMainCharacter } from "./curatedSets";

export interface Character {
  /** File name without .md. Empty for a character that has not been saved yet. */
  id: string;
  isMain: boolean;
  values: Values;
  /** Background summary: the file's body. */
  background: string;
  /** Header keys the form does not know; written back unchanged. */
  extra: Record<string, unknown>;
}

const MAIN_KEY = "main_character";

const charactersDir = (storyId: string) => `${storyDir(storyId)}/characters`;
const characterPath = (storyId: string, id: string) => `${charactersDir(storyId)}/${id}.md`;

/**
 * A new character. A main character starts as the given example, by default the
 * type's first set in English (decisions 45, 85); others start empty.
 */
export function newCharacter(
  type: StoryType,
  isMain: boolean,
  main?: { values: Values; background: string },
): Character {
  const values = defaultValues(characterFields(type));
  const firstSet = getSet(type.id);
  const example = isMain ? (main ?? (firstSet && setMainCharacter(firstSet, "English"))) : undefined;
  if (!example) return { id: "", isMain, values, background: "", extra: {} };
  return { id: "", isMain, values: { ...values, ...structuredClone(example.values) }, background: example.background, extra: {} };
}

export function characterName(c: Character): string {
  return String(c.values.name ?? "").trim() || "Unnamed character";
}

/** Field keys not shown for this character. */
export function hiddenKeys(fields: FieldDef[], isMain: boolean): Set<string> {
  return new Set(fields.filter((f) => isMain && f.hideForMain).map((f) => f.key));
}

/** Field keys this character must fill in, given the story type's rules. */
export function requiredKeys(type: StoryType, fields: FieldDef[], isMain: boolean): Set<string> {
  const keys = new Set(fields.filter((f) => f.required).map((f) => f.key));
  if (isMain) for (const k of type.rules.mainCharacterRequired ?? []) keys.add(k);
  if (type.rules.minAge !== undefined) keys.add("age");
  return keys;
}

function parseCharacter(fields: FieldDef[], id: string, text: string): Character {
  const doc = parseMarkDoc(text);
  const { [MAIN_KEY]: main, ...header } = doc.header;
  const { values, extra } = valuesFromHeader(fields, header);
  return { id, isMain: main === true, values, background: doc.body, extra };
}

export interface CharacterList {
  characters: Character[];
  /** Files that could not be read, so the user can fix them by hand. */
  unreadable: { file: string; error: string }[];
}

/** All characters, main character first, then by name. */
export async function listCharacters(story: Story): Promise<CharacterList> {
  const fields = characterFields(getStoryType(story.type));
  const out: CharacterList = { characters: [], unreadable: [] };
  for (const entry of await store.list(charactersDir(story.id))) {
    if (entry.isDirectory || !entry.name.endsWith(".md")) continue;
    const id = entry.name.slice(0, -3);
    try {
      out.characters.push(parseCharacter(fields, id, await store.readText(characterPath(story.id, id))));
    } catch (e) {
      out.unreadable.push({ file: entry.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  out.characters.sort(
    (a, b) => Number(b.isMain) - Number(a.isMain) || characterName(a).localeCompare(characterName(b)),
  );
  return out;
}

/** Saves a character and returns it with its id. Refuses a second main character. */
export async function saveCharacter(story: Story, character: Character): Promise<Character> {
  const fields = characterFields(getStoryType(story.type));

  if (character.isMain) {
    const { characters } = await listCharacters(story);
    if (characters.some((c) => c.isMain && c.id !== character.id)) {
      throw new Error(t("error.secondMain"));
    }
  }

  const values = normalize(fields, character.values);
  const id = character.id || makeId(String(values.name ?? ""), "character");
  const { name, ...rest } = headerFromValues(fields, values, hiddenKeys(fields, character.isMain), character.extra);
  const header = { name, [MAIN_KEY]: character.isMain, ...rest };
  await store.writeText(characterPath(story.id, id), formatMarkDoc({ header, body: character.background }));
  await updateStory(story.id, {});
  return { ...character, id, values };
}

/**
 * True if the name appears in any finished chapter. Such characters are
 * marked dead or inactive instead of deleted (spec 7.1).
 */
export async function hasAppeared(storyId: string, name: string): Promise<boolean> {
  const needle = name.trim();
  if (!needle) return false;
  const chaptersDir = `${storyDir(storyId)}/chapters`;
  for (const entry of await store.list(chaptersDir)) {
    const path = `${chaptersDir}/${entry.name}/chapter.md`;
    if (entry.isDirectory && (await store.exists(path)) && (await store.readText(path)).includes(needle)) {
      return true;
    }
  }
  return false;
}

export async function deleteCharacter(story: Story, character: Character): Promise<void> {
  if (character.isMain) throw new Error(t("error.deleteMain"));
  if (await hasAppeared(story.id, characterName(character))) {
    throw new Error(t("error.appeared"));
  }
  await store.remove(characterPath(story.id, character.id));
  await updateStory(story.id, {});
}

/**
 * The main character of the story's curated set, in the story's language (spec 7.1).
 * Given the story's setting, a race or rank the setting's lists no longer have is
 * left empty, so clearing the adventurer ranks turns them off for the main
 * character too (decision 104, QA-03).
 */
export function exampleMainCharacter(story: Story, setting?: Values): { values: Values; background: string } | undefined {
  const set = getSet(story.type, story.setId);
  const example = set && setMainCharacter(set, story.language);
  if (!example || !setting) return example;
  const picks = pickOptionsFor(characterFields(getStoryType(story.type)), setting);
  for (const [key, options] of Object.entries(picks)) {
    if (example.values[key] && !options.includes(String(example.values[key]))) delete example.values[key];
  }
  return example;
}

/** Reads only the main_character flag, without needing the story type. */
async function hasMainCharacter(storyId: string): Promise<boolean> {
  for (const entry of await store.list(charactersDir(storyId))) {
    if (entry.isDirectory || !entry.name.endsWith(".md")) continue;
    try {
      const { header } = parseMarkDoc(await store.readText(`${charactersDir(storyId)}/${entry.name}`));
      if (header[MAIN_KEY] === true) return true;
    } catch {
      // An unreadable file is reported on the Characters tab, not here.
    }
  }
  return false;
}

/** What still has to be done before the Novel page unlocks. */
export interface StoryReadiness {
  hasSetting: boolean;
  hasMainCharacter: boolean;
}

export async function getReadiness(storyId: string): Promise<StoryReadiness> {
  return {
    hasSetting: await store.exists(`${storyDir(storyId)}/setting.md`),
    hasMainCharacter: await hasMainCharacter(storyId),
  };
}
