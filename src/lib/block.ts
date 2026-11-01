/**
 * The shape of one block as the AI writes it (spec 6.3, decision 36):
 *
 *   <story text>
 *
 *   === NEXT ===
 *   <suggested action> | <what it might do>
 *   <suggested action> | <what it might do>
 *   MAIN CHARACTER DIED: no
 *   MOOD: none
 *   PICTURE: <the scene, in English>     (only asked for when images are Rich, spec 14.2)
 *
 * Plain text rather than JSON, so the story part can be shown while it streams.
 */
import { Mood, readMood } from "./mood";

/** The line that separates the story text from the suggestions. */
export const NEXT_MARKER = "=== NEXT ===";

// Lenient about spacing, case and the number of "=", which models vary. It may also
// sit at the end of a story line, with no line break before it (decision 90).
const MARKER = /={2,}[ \t]*NEXT[ \t]*={2,}/i;
// The end of an answer still arriving that may become the marker: "=", "==", "=== NE"…
const MARKER_START = /[ \t]*=+[ \t]*(?:N(?:E(?:X(?:T[ \t]*=*)?)?)?)?$/i;
const DIED_LINE = /^MAIN[ _]CHARACTER[ _]DIED\s*:\s*(\S+)/i;
// The music for the block (spec 13); "none" and unknown moods mean no music.
const MOOD_LINE = /^MOOD\s*:\s*(\S*)/i;
// The scene for the block's picture (spec 14.2); never shown.
const PICTURE_LINE = /^PICTURE\s*:\s*(.*)$/i;
// List markers models like to add: "-", "*", "•", "1.", "2)", "1、", "ACTION:".
const ACTION_PREFIX = /^(?:[-*•]|\d+[.)、]|ACTION\s*:)\s*/i;

export const MAX_ACTIONS = 3;

/** Between an action and its note (decision 86); the full-width bar is common in Chinese answers. */
const NOTE_SEPARATOR = /\s*[|｜]\s*/;

export interface ParsedBlock {
  /** The story text, trimmed. */
  text: string;
  /** Up to three suggested next actions. */
  actions: string[];
  /** A short note per action on what it might do; "" where the AI gave none (decision 86). */
  notes: string[];
  /** True when the AI says the main character died in this block (spec 5.5). */
  died: boolean;
  /** The music the block asks for (spec 13); missing for "none", no mood line or an unknown mood. */
  mood?: Mood;
  /** The scene for the block's picture (spec 14.2); missing when the AI wrote no picture line. */
  picture?: string;
  /** False when the marker was missing, so there are no actions (decision 37). */
  complete: boolean;
}

/** The flag's value if the line is only the died flag (bold allowed), otherwise null. */
function flagValue(line: string): boolean | null {
  const flag = DIED_LINE.exec(line.replace(/\*\*/g, "").trim());
  return flag ? /^(yes|true|y)\b/i.test(flag[1]) : null;
}

/** The mood if the line is only the mood line (bold allowed): a mood, "none" for no music, or null for another line. */
function moodValue(line: string): Mood | "none" | null {
  const mood = MOOD_LINE.exec(line.replace(/\*\*/g, "").trim());
  return mood ? (readMood(mood[1]) ?? "none") : null;
}

/** The scene if the line is only the picture line (bold allowed): the scene, "" when empty, or null for another line. */
function pictureValue(line: string): string | null {
  const picture = PICTURE_LINE.exec(line.replace(/\*\*/g, "").trim());
  return picture ? picture[1].trim().replace(/^["“]|["”]$/g, "").trim() : null;
}

/**
 * Removes lines that are only the died flag, the mood line or the picture line.
 * A model that leaves out the marker may still write them, and readers must
 * never see them (decision 54, spec 6.3).
 */
export function stripFlagLines(text: string): string {
  if (!/MAIN[ _]CHARACTER[ _]DIED|MOOD|PICTURE/i.test(text)) return text;
  return text
    .split(/\r?\n/)
    .filter((line) => flagValue(line) === null && moodValue(line) === null && pictureValue(line) === null)
    .join("\n")
    .trim();
}

/** The scene of the last non-empty picture line, if any. */
function lastPicture(lines: string[]): string | undefined {
  return lines.map(pictureValue).filter((p): p is string => !!p).at(-1);
}

/** The mood of the last mood line, or undefined when there is none or it says "none". */
function lastMood(lines: string[]): Mood | undefined {
  const mood = lines.map(moodValue).filter((m) => m !== null).at(-1);
  return mood === "none" ? undefined : mood;
}

/** Adds the mood and the picture scene only when there are some, so saved blocks without them stay as they were. */
function withMood(block: ParsedBlock, mood: Mood | undefined, picture?: string): ParsedBlock {
  const out = mood ? { ...block, mood } : block;
  return picture ? { ...out, picture } : out;
}

export function parseBlock(raw: string): ParsedBlock {
  const marker = MARKER.exec(raw);
  if (!marker) {
    // No marker: no actions, but a flag or mood line is still read, and kept out of the story (decision 54).
    const lines = raw.split(/\r?\n/);
    const flags = lines.map(flagValue).filter((v): v is boolean => v !== null);
    const block = { text: stripFlagLines(raw).trim(), actions: [], notes: [], died: flags.at(-1) ?? false, complete: false };
    return withMood(block, lastMood(lines), lastPicture(lines));
  }

  const actions: string[] = [];
  const notes: string[] = [];
  let died = false;
  let mood: Mood | undefined;
  let picture: string | undefined;
  for (const rawLine of raw.slice(marker.index + marker[0].length).split(/\r?\n/)) {
    // Models sometimes add markdown bold around the flag or the actions.
    const line = rawLine.replace(/\*\*/g, "").trim();
    if (!line) continue;
    const scene = pictureValue(line);
    if (scene !== null) {
      if (scene) picture = scene;
      continue;
    }
    const flag = flagValue(line);
    if (flag !== null) {
      died = flag;
      continue;
    }
    const moodLine = moodValue(line);
    if (moodLine !== null) {
      mood = moodLine === "none" ? undefined : moodLine;
      continue;
    }
    const [action, ...rest] = line.replace(ACTION_PREFIX, "").split(NOTE_SEPARATOR);
    if (action.trim() && actions.length < MAX_ACTIONS) {
      actions.push(action.trim());
      notes.push(rest.join(" ").trim());
    }
  }
  return withMood({ text: raw.slice(0, marker.index).trim(), actions, notes, died, complete: true }, mood, picture);
}

/**
 * The part of a block still arriving that can be shown: the text before the
 * marker. A last line, or the end of a line, that could be the start of the
 * marker is held back until it is complete, so "==" never flashes on screen.
 */
export function visibleText(partial: string): string {
  const marker = MARKER.exec(partial);
  if (marker) return partial.slice(0, marker.index).trimEnd();
  const lastBreak = partial.lastIndexOf("\n");
  const lastLine = partial.slice(lastBreak + 1);
  if (mayBecomeHidden(lastLine)) return stripFlagLines(partial.slice(0, Math.max(lastBreak, 0))).trimEnd();
  return stripFlagLines(partial.replace(MARKER_START, ""));
}

/**
 * Removes the marker and the suggestion lines after it (up to the next blank
 * line) from saved text: blocks and chapters written before decision 90 kept
 * them when the marker ended a story line. Files are not rewritten.
 */
export function stripSuggestions(text: string): string {
  if (!MARKER.test(text)) return text;
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    const marker = MARKER.exec(line);
    if (marker) {
      const before = line.slice(0, marker.index).trimEnd();
      if (before) out.push(before);
      skipping = true;
    } else if (skipping) {
      if (!line.trim()) {
        skipping = false;
        out.push(line);
      }
    } else {
      out.push(line);
    }
  }
  return out.join("\n").trim();
}

/** True when saved text still holds the marker (decision 90). */
export function hasMarker(text: string): boolean {
  return MARKER.test(text);
}

/** A last line that may still turn into the marker, the flag line, the mood line or the picture line (decision 54). */
function mayBecomeHidden(line: string): boolean {
  const start = line.replace(/\*\*/g, "").trimStart().toUpperCase().replace(/_/g, " ");
  if (start.startsWith("=")) return true;
  if (!start) return false;
  return ["MAIN CHARACTER DIED", "MOOD:", "PICTURE:"].some((hidden) => hidden.startsWith(start) || start.startsWith(hidden));
}
