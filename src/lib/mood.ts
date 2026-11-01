/**
 * The moods the AI can give a block, each with its music track (spec 13.1,
 * decision 130). Music is for emotional peaks only: most blocks are "none",
 * which is not a mood here but the absence of one.
 */
export const MOODS = ["tense", "battle", "reveal", "sad", "triumphant", "romantic"] as const;

export type Mood = (typeof MOODS)[number];

/** What each mood is for, as the prompt tells the AI (spec 13.1). */
export const MOOD_MEANINGS: Record<Mood, string> = {
  tense: "a fight or capture about to break out in this very block: weapons drawn, a standoff, a chase about to start",
  battle: "a fight, a duel, a chase",
  reveal: "a major twist, a shocking truth, an identity exposed",
  sad: "a death, a parting, a heavy loss",
  triumphant: "a victory, a breakthrough, a happy ending",
  romantic: "a confession, a first kiss, a big romance moment",
};

export function isMood(value: unknown): value is Mood {
  return typeof value === "string" && (MOODS as readonly string[]).includes(value);
}

/** A mood from the AI's answer or a saved file; "none", unknown words and anything else give undefined. */
export function readMood(value: unknown): Mood | undefined {
  const word = typeof value === "string" ? value.trim().toLowerCase().replace(/[.*`"']/g, "") : "";
  return isMood(word) ? word : undefined;
}
