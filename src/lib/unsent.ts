/**
 * What the user typed on the Novel page but has not sent yet: the direction and
 * the regenerate hint, per story. Held in memory so that leaving the story and
 * coming back keeps it, for example after fixing the key in Settings (decision 59).
 * It is not written to disk; closing the app clears it.
 */
export interface Unsent {
  direction: string;
  hint: string;
}

const unsent = new Map<string, Unsent>();

export function getUnsent(storyId: string): Unsent {
  return unsent.get(storyId) ?? { direction: "", hint: "" };
}

export function setUnsent(storyId: string, change: Partial<Unsent>): void {
  const next = { ...getUnsent(storyId), ...change };
  if (next.direction || next.hint) unsent.set(storyId, next);
  else unsent.delete(storyId);
}
