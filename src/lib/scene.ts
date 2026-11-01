/**
 * "Characters in the scene" (spec 6.1): the main character, plus every
 * character whose name appears in the current chapter, the user's direction or
 * the previous chapter's summary. A plain name match, with no extra AI call.
 */
import type { Character } from "./characters";

/** Scripts written without spaces between words. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True if the name appears in the text (decision 40). Names in Latin script
 * must be whole words, so "Ann" does not match "Annual". Chinese, Japanese and
 * Korean names match anywhere, since those scripts have no word breaks.
 */
export function mentions(text: string, name: string): boolean {
  const needle = name.trim();
  if (!needle) return false;
  if (NO_SPACES.test(needle)) return text.includes(needle);
  // Only Latin letters and digits count as "the same word", so "Alex说" in a Chinese novel still matches.
  const word = `[\\p{Script=Latin}\\p{N}]`;
  return new RegExp(`(?<!${word})${escapeRegExp(needle)}(?!${word})`, "u").test(text);
}

/** Main character first, then the others in the order given. Inactive characters are left out. */
export function charactersInScene(characters: Character[], texts: string[]): Character[] {
  const text = texts.join("\n");
  return [
    ...characters.filter((c) => c.isMain),
    ...characters.filter(
      (c) => !c.isMain && c.values.status !== "Inactive" && mentions(text, String(c.values.name ?? "")),
    ),
  ];
}
