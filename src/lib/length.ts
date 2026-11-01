/**
 * Lengths: chapter word counts and limits (spec 5.3), the story's arc (spec 5.7)
 * and token estimates for the budget caps (spec 6.2).
 */

/** Scripts written without spaces between words. */
const NO_SPACE_CHARS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Languages counted in characters instead of words: Chinese and Japanese
 * (decisions 24, 48). Korean uses spaces, so it is counted in words.
 */
export function countsCharacters(language: string): boolean {
  return /chinese|japanese|中文|日本語/i.test(language) || NO_SPACE_CHARS.test(language);
}

/** Words, or characters (spaces left out) for languages without spaces. */
export function countWords(text: string, language: string): number {
  if (countsCharacters(language)) return text.replace(/\s/g, "").length;
  return text.split(/\s+/).filter(Boolean).length;
}

export type LengthUnit = "words" | "characters";

export interface ChapterLimits {
  /** The soft limit: the AI steers toward an ending from here. */
  target: number;
  /** 150% of the target: the next block concludes the chapter. */
  hard: number;
  unit: LengthUnit;
}

/** Spec 5.3. Starting values, to tune after reading real output. */
const TARGETS: Record<string, { words: number; characters: number }> = {
  Short: { words: 1500, characters: 2500 },
  Medium: { words: 2500, characters: 4000 },
  Long: { words: 4000, characters: 6500 },
};

export function chapterLimits(chapterLength: string, language: string): ChapterLimits {
  const unit: LengthUnit = countsCharacters(language) ? "characters" : "words";
  const target = (TARGETS[chapterLength] ?? TARGETS.Medium)[unit];
  return { target, hard: Math.round(target * 1.5), unit };
}

/** Where the chapter is: below the target, past it (steer to an ending), or at the hard limit (conclude). */
export type ChapterStage = "open" | "soft" | "hard";

export function chapterStage(count: number, limits: ChapterLimits): ChapterStage {
  if (count >= limits.hard) return "hard";
  if (count >= limits.target) return "soft";
  return "open";
}

/** Characters per word, from spec 5.3 (2,500 characters for 1,500 words); decision 53. */
const CHARACTERS_PER_WORD = 5 / 3;

/** The end of a text: the last n words, or the matching number of characters in a language without spaces. */
export function tailText(text: string, words: number, language: string): string {
  if (words <= 0) return "";
  if (countsCharacters(language)) {
    const n = Math.round(words * CHARACTERS_PER_WORD);
    const trimmed = text.trim();
    return trimmed.length <= n ? trimmed : trimmed.slice(-n);
  }
  return text.trim().split(/\s+/).filter(Boolean).slice(-words).join(" ");
}

/** A rough token count for budget caps: words × 4/3, or one per character without spaces (decision 53). */
export function estimateTokens(text: string, language: string): number {
  if (countsCharacters(language)) return text.replace(/\s/g, "").length;
  return Math.ceil((countWords(text, language) * 4) / 3);
}

/** A token cap turned into the unit the AI is asked to write in. */
export function tokensToLength(tokens: number, language: string): { amount: number; unit: LengthUnit } {
  return countsCharacters(language)
    ? { amount: tokens, unit: "characters" }
    : { amount: Math.floor((tokens * 3) / 4), unit: "words" };
}

export interface ChapterProgress {
  count: number;
  limits: ChapterLimits;
  stage: ChapterStage;
}

/** The chapter's length so far against its limits, from the setting's chapter length and language. */
export function chapterProgress(blocks: string[], chapterLength: string, language: string): ChapterProgress {
  const limits = chapterLimits(chapterLength, language);
  const count = countWords(blocks.join("\n\n"), language);
  return { count, limits, stage: chapterStage(count, limits) };
}

// ---------- story length (spec 5.7, decision 47) ----------

export const STORY_LENGTHS = ["Short story", "Long story", "Continuous"] as const;

const PLANNED: Record<string, number | null> = { "Short story": 8, "Long story": 60, Continuous: null };
/** Chapters per volume of a Long story. */
export const VOLUME_CHAPTERS = 20;

/** The planned number of chapters, or null for a continuous story. */
export function plannedChapters(storyLength: string): number | null {
  return PLANNED[storyLength] ?? null;
}

/** How the whole story is paced: sent with the writing instructions. */
export function storyLengthRule(storyLength: string): string {
  switch (storyLength) {
    case "Short story":
      return "Story length: a short story of about 8 chapters, told as one arc: set-up, rising conflict, climax and resolution.";
    case "Long story":
      return `Story length: a long story of about 60 chapters in 3 volumes of about ${VOLUME_CHAPTERS}. Each volume has its own arc and climax, and the whole story builds to a final climax.`;
    default:
      return "Story length: continuous, with no planned end. Let one arc lead into the next and never resolve the main conflict for good.";
  }
}

/** Where this chapter sits in the story's arc. */
export function storyArcStage(storyLength: string, chapter: number): string {
  const planned = plannedChapters(storyLength);
  if (planned === null) {
    return `Chapter ${chapter} of a continuous story: keep the current arc moving; when it resolves, open the next one.`;
  }
  if (chapter > planned) {
    return `Chapter ${chapter}, past the planned ${planned} chapters: wrap up what is left and bring the story to its close.`;
  }
  if (chapter >= planned - 1) {
    return `Chapter ${chapter} of about ${planned}, one of the last two: steer toward the finale and resolve the central conflict by chapter ${planned}.`;
  }
  if (storyLength === "Long story") {
    const volume = Math.ceil(chapter / VOLUME_CHAPTERS);
    const inVolume = chapter - (volume - 1) * VOLUME_CHAPTERS;
    if (inVolume <= 2) return `Chapter ${chapter} of about ${planned}, the opening of volume ${volume}: set up this volume's arc.`;
    if (inVolume >= VOLUME_CHAPTERS - 1) {
      return `Chapter ${chapter} of about ${planned}, the end of volume ${volume}: bring this volume's arc to its climax.`;
    }
    return `Chapter ${chapter} of about ${planned}, chapter ${inVolume} of volume ${volume}: develop this volume's arc.`;
  }
  if (chapter <= 2) return `Chapter ${chapter} of about ${planned}, the set-up: introduce the world, the main character and the central conflict.`;
  return `Chapter ${chapter} of about ${planned}, the rising conflict: raise the stakes and complicate the central conflict.`;
}

/** True once the planned chapters are written, so the End story button is highlighted (spec 5.7). */
export function finaleReached(storyLength: string, finishedChapters: number): boolean {
  const planned = plannedChapters(storyLength);
  return planned !== null && finishedChapters >= planned;
}
