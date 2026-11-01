/**
 * Curated sets (spec 4, 8; decisions 72, 85): ready-made worlds per story
 * type, each with a main character and a name pool, in all three novel
 * languages. A new story starts with a random one, Randomize picks another,
 * and the character forms take names and the main character from it.
 *
 * Values that do not depend on the language (choices, scales) are stored
 * once; text (background, names, sects, the rank ladder) once per language.
 */
import { Locale, novelLocale } from "../i18n";
import cultivation from "../storyTypes/sets/cultivation.json";
import fantasy from "../storyTypes/sets/fantasy.json";
import romance from "../storyTypes/sets/romance.json";
import type { Values } from "./fields";

export interface SetText {
  /** Setting fields whose value is text in this language. */
  values: Values;
  background: string;
  /** Main character fields whose value is text in this language. */
  main: Values;
  mainBackground: string;
  names: { male: string[]; female: string[] };
}

export interface CuratedSet {
  id: string;
  /** Setting fields that are the same in every language. */
  values: Values;
  /** Main character fields that are the same in every language. */
  main: Values;
  text: Record<Locale, SetText>;
}

const SETS: Record<string, CuratedSet[]> = {
  cultivation: cultivation as unknown as CuratedSet[],
  romance: romance as unknown as CuratedSet[],
  fantasy: fantasy as unknown as CuratedSet[],
};

export function setsOf(typeId: string): CuratedSet[] {
  return SETS[typeId] ?? [];
}

/** The story's set, or the type's first one for a story from before sets (spec 8). */
export function getSet(typeId: string, setId?: string): CuratedSet | undefined {
  const sets = setsOf(typeId);
  return sets.find((s) => s.id === setId) ?? sets[0];
}

/** A random set of the type, never `exceptId` when there is another to pick. */
export function randomSet(typeId: string, exceptId?: string, random = Math.random): CuratedSet | undefined {
  const sets = setsOf(typeId);
  const pool = sets.length > 1 ? sets.filter((s) => s.id !== exceptId) : sets;
  return pool[Math.floor(random() * pool.length)];
}

/** The set's text language for a novel language; any other language gets English (spec 8). */
export function textLocale(language: string): Locale {
  return novelLocale(language) ?? "en";
}

function textOf(set: CuratedSet, language: string): SetText {
  return set.text[textLocale(language)] ?? set.text.en;
}

/** Every setting field the set covers, in the novel's language. */
export function setValues(set: CuratedSet, language: string): Values {
  return structuredClone({ ...set.values, ...textOf(set, language).values });
}

export function setBackground(set: CuratedSet, language: string): string {
  return textOf(set, language).background;
}

/** The set's main character, in the novel's language. */
export function setMainCharacter(set: CuratedSet, language: string): { values: Values; background: string } {
  const text = textOf(set, language);
  return { values: structuredClone({ ...set.main, ...text.main }), background: text.mainBackground };
}

/** Fills the fields the set covers and the background; other fields keep their values (spec 8). */
export function applySet(
  values: Values,
  set: CuratedSet,
  language: string,
): { values: Values; background: string } {
  return { values: { ...values, ...setValues(set, language) }, background: setBackground(set, language) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * After the novel's language changed on the Setting page: every field (and the
 * background) still holding the set's text in the old language gets it in the
 * new one. What the user typed stays (spec 8).
 */
export function switchSetLanguage(
  values: Values,
  background: string,
  set: CuratedSet,
  from: string,
  to: string,
): { values: Values; background: string } {
  const old = textOf(set, from);
  const next = textOf(set, to);
  const out = { ...values };
  for (const [key, value] of Object.entries(old.values)) {
    if (same(values[key], value)) out[key] = structuredClone(next.values[key]);
  }
  return { values: out, background: background === old.background ? next.background : background };
}

/**
 * A name from the set's pool (spec 7.1): fitting the gender (any for other
 * genders or none), not taken by a character, not the current one. Null when
 * every name is used.
 */
export function randomName(
  set: CuratedSet,
  language: string,
  gender: unknown,
  taken: string[],
  current = "",
  random = Math.random,
): string | null {
  const { male, female } = textOf(set, language).names;
  const pool = gender === "Male" ? male : gender === "Female" ? female : [...male, ...female];
  const used = new Set([...taken, current].map((n) => n.trim().toLowerCase()));
  const free = pool.filter((n) => !used.has(n.toLowerCase()));
  return free.length ? free[Math.floor(random() * free.length)] : null;
}
