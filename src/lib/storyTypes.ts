/**
 * Story types (genres).
 *
 * Each type is a config file in src/storyTypes/: its extra setting and
 * character fields, its rules for characters, and its prompt fragments. Its
 * curated sets (example worlds) are in src/storyTypes/sets/ (curatedSets.ts).
 * common.json holds the fields every type shares. Adding a genre means adding
 * one file and listing it below.
 */
import { Locale, t, typeName } from "../i18n";
import common from "../storyTypes/common.json";
import cultivation from "../storyTypes/cultivation.json";
import fantasy from "../storyTypes/fantasy.json";
import general from "../storyTypes/general.json";
import romance from "../storyTypes/romance.json";
import type { FieldDef } from "./fields";

export interface StoryTypeRules {
  /** Field keys the main character must fill in. */
  mainCharacterRequired?: string[];
  /** Lowest allowed character age. */
  minAge?: number;
  /** Age given to an AI-proposed new character that came without one, or below minAge (decision 67). */
  defaultAge: number;
}

export interface StoryType {
  id: string;
  name: string;
  description: string;
  settingFields: FieldDef[];
  characterFields: FieldDef[];
  rules: StoryTypeRules;
  /** This genre's defaults for common setting fields, e.g. the tone (decision 44). */
  settingDefaults?: Record<string, unknown>;
  /** The genre's writing instructions, sent at the top of every prompt (phase 3). */
  prompt: string[];
  /** The art style of every picture in a story of this type, sent to the image model (spec 14.2, decision 144). */
  imageStyle: string;
  /**
   * False when the AI offers no suggested actions under a block and no openings
   * for the next chapter, so every block needs the user's direction (spec 4,
   * decisions 125, 126). Left out means true.
   */
  suggestions?: boolean;
  /**
   * True when the type's own setting fields come before the shared Story
   * fields on the Setting page, because they are what the user must write
   * first (General, decision 129).
   */
  worldFirst?: boolean;
}

export const STORY_TYPES = [cultivation, romance, fantasy, general] as unknown as StoryType[];

/** Whether the AI offers suggested actions and chapter openings in this type (decision 125). */
export function hasSuggestions(type: StoryType): boolean {
  return type.suggestions !== false;
}

const COMMON = common as unknown as {
  setting: FieldDef[];
  character: { head: FieldDef[]; tail: FieldDef[] };
};

export function getStoryType(id: string): StoryType {
  const type = STORY_TYPES.find((t) => t.id === id);
  if (!type) throw new Error(t("error.unknownType", { id }));
  return type;
}

/** The type's name in the UI language. */
export function storyTypeName(id: string): string {
  const type = STORY_TYPES.find((x) => x.id === id);
  return type ? typeName(type) : id;
}

/** Every field on the Setting page, in display order. */
export function settingFields(type: StoryType): FieldDef[] {
  const defaults = type.settingDefaults ?? {};
  const common = COMMON.setting.map((f) => (f.key in defaults ? { ...f, default: defaults[f.key] } : f));
  return type.worldFirst ? [...type.settingFields, ...common] : [...common, ...type.settingFields];
}

/** Every field on a character form, in display order. Status comes last. */
export function characterFields(type: StoryType): FieldDef[] {
  return [...COMMON.character.head, ...type.characterFields, ...COMMON.character.tail];
}

/**
 * The languages a novel can be written in: the UI's three (decision 71). The
 * value is saved in story.json and setting.md and sent to the AI as it is.
 * Stories from before phase 6 may hold another language; they still work.
 */
export const NOVEL_LANGUAGES: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "简体中文 (Simplified Chinese)",
  "zh-Hant": "繁體中文 (Traditional Chinese)",
};

export const LANGUAGES = Object.values(NOVEL_LANGUAGES);
