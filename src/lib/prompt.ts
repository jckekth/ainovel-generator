/**
 * Builds the messages for one block (spec 6).
 *
 * Every request sends the same capped layers in the order of spec 6.1, never
 * the full history. Parts that rarely change come first, so providers with
 * prompt caching can discount them. Layer 1 is the system message; layers 2-10
 * are one user message under headings (decision 41).
 */
import type { ChatMessage } from "./ai";
import { NEXT_MARKER } from "./block";
import { Character, characterName, hiddenKeys } from "./characters";
import { headerFromValues, localizeChoices } from "./fields";
import { Locale, novelLocale, optionLabel } from "../i18n";
import { chapterLimits, chapterProgress, estimateTokens, storyArcStage, storyLengthRule, tailText } from "./length";
import { formatMarkDoc } from "./markdoc";
import { languageStyle } from "./languageStyle";
import { MOOD_MEANINGS, MOODS } from "./mood";
import { charactersInScene } from "./scene";
import type { SettingDoc } from "./setting";
import type { ContextBudget } from "./settings";
import { characterFields, hasSuggestions, settingFields, StoryType } from "./storyTypes";

export interface Budget {
  /** Cap of the "story so far" summary, kept by the End Chapter call (phase 4). */
  storySummaryTokens: number;
  /** Cap of the used scenes list (spec 6.4), kept by the End Chapter call. */
  usedScenesTokens: number;
  /** How many of the most recent chapter summaries are sent. */
  recentSummaries: number;
  /** How many words from the end of the previous chapter are sent. */
  previousTailWords: number;
  /** "header": header fields only. "full": the whole file. Rich also adds the characters named in the last 3 chapters. */
  characterDetail: "header" | "full";
}

/** Spec 6.2. */
export const BUDGETS: Record<ContextBudget, Budget> = {
  lean: { storySummaryTokens: 600, usedScenesTokens: 200, recentSummaries: 1, previousTailWords: 0, characterDetail: "header" },
  balanced: { storySummaryTokens: 1000, usedScenesTokens: 300, recentSummaries: 3, previousTailWords: 300, characterDetail: "full" },
  rich: { storySummaryTokens: 1500, usedScenesTokens: 450, recentSummaries: 5, previousTailWords: 600, characterDetail: "full" },
};

export type LayerId =
  | "instructions"
  | "setting"
  | "notes"
  | "characters"
  | "story-so-far"
  | "used-scenes"
  | "recent-chapters"
  | "previous-tail"
  | "chapter"
  | "direction";

export interface PromptInput {
  storyType: StoryType;
  setting: SettingDoc;
  notes: string[];
  /** Every character of the story; the ones in the scene are picked here. */
  characters: Character[];
  budget: ContextBudget;
  chapter: number;
  /** The chosen text of each block written so far in this chapter. */
  blocks: string[];
  /** The user's direction for the next block. Empty for an undirected first block. */
  direction: string;
  /** Regenerate hint, e.g. "make the fight shorter". */
  hint?: string;
  /** The "story so far" summary (the story's summary.md). */
  storySummary?: string;
  /** The used scenes list (the story's scenes.md, spec 6.4). */
  usedScenes?: string[];
  /** Summaries of finished chapters, oldest first. The last one is the previous chapter's. */
  chapterSummaries?: string[];
  /** The previous chapter's text; only its end is sent. */
  previousChapter?: string;
  /** Texts of the last finished chapters, newest last; the Rich budget adds the characters named in them. */
  recentChapters?: string[];
  /** Writes the epilogue instead of a block (spec 5.5). */
  epilogue?: { mainCharacterDied: boolean };
  /** Asks for a picture line too: images are on Rich (spec 14.2). */
  pictures?: boolean;
}

export interface Prompt {
  messages: ChatMessage[];
  /** Ids of the layers that were sent, in order. */
  layers: LayerId[];
  /** Names of the characters sent as "in the scene". */
  scene: string[];
}

const POINT_OF_VIEW: Record<string, (name: string) => string> = {
  "Main character, first person": (name) => `first person, told by the main character, ${name}`,
  "Main character, third person": (name) => `third person, staying close to the main character, ${name}`,
  "God view": () => "an all-seeing narrator in the third person, free to show any character's thoughts",
};

const CONTENT_RATING: Record<string, string> = {
  General: "General. Nothing graphic; violence and romance stay suitable for a general audience.",
  Mature: "Mature. Darker themes and harsher violence are allowed. Intimate scenes always fade to black.",
};

/** Spec 5.5: the story's "Main character death" setting. */
const DEATH_RULE: Record<string, string> = {
  Never: "The main character never dies in this story, even if a direction asks for it.",
  "Only when I direct it":
    "The main character dies only if the user's direction for this block explicitly says so.",
  "The AI may decide": "The main character may die when the story and the cruelty of the world call for it.",
};

function text(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "").trim();
}

/** The novel's language, from the setting. */
function languageOf(input: PromptInput): string {
  return text(input.setting.values.language) || "English";
}

/** The language choice values are sent in: the novel's, or English for one outside the three (spec 6.5). */
function choiceLocale(input: PromptInput): Locale {
  return novelLocale(languageOf(input)) ?? "en";
}

/** A setting choice (or list of choices) in the novel's language, e.g. the tone (decision 84). */
function settingChoice(input: PromptInput, key: string): string {
  const field = settingFields(input.storyType).find((f) => f.key === key);
  const v = input.setting.values[key];
  if (!field) return text(v);
  const show = (x: unknown) => optionLabel(field, String(x ?? "").trim(), choiceLocale(input));
  return Array.isArray(v) ? v.map(show).join(", ") : text(v) && show(v);
}

/**
 * The mood line that picks the block's music (spec 13.1, decision 130). Music
 * is for emotional peaks only, so "none" must be the usual answer. A dark or
 * suspenseful story otherwise reads every block as a peak (decision 139).
 */
const MOOD_RULE = [
  "Then the mood line, which picks background music for this block. Music is only for a real emotional peak, so for most blocks write `MOOD: none`. Ordinary suspense, hiding, sneaking, searching, travel, talk, clues and worry are not peaks, even in a dark story. As a guide, about one block in four has a mood. Only when this block reaches a peak, write one of:",
  ...MOODS.map((m) => `- \`MOOD: ${m}\`: ${MOOD_MEANINGS[m]}`),
].join("\n");

/**
 * The picture line (spec 14.2, decision 143): the scene for an image model, in
 * English whatever the novel's language, naming the characters so the app can
 * add how each one looks.
 */
export const PICTURE_RULE =
  "Then the picture line: `PICTURE: ` and one or two sentences in English describing the single most striking moment of this block as a picture: who is there (by their names as written in the story), where, what is happening, the light and the mood. Describe only what can be seen; no dialogue, no text. Keep it non-explicit.";

function instructions(input: PromptInput, mainName: string): string {
  const v = input.setting.values;
  const language = languageOf(input);
  const epilogue = input.epilogue;
  // Decision 125: a type without suggestions asks for none; the answer ends at the flag line.
  const suggests = !epilogue && hasSuggestions(input.storyType);
  const pov = POINT_OF_VIEW[text(v.point_of_view)] ?? POINT_OF_VIEW["Main character, third person"];
  const rules = [
    suggests ? `Language: write the story and the suggested actions in ${language}.` : `Language: write in ${language}.`,
    `Point of view: ${pov(mainName)}.`,
    text(v.tone) && `Tone: ${settingChoice(input, "tone")}.`,
    text(v.narration_detail) && `Narration detail: ${settingChoice(input, "narration_detail")}.`,
    `Content rating: ${CONTENT_RATING[text(v.content_rating)] ?? CONTENT_RATING.General}`,
    !epilogue && (DEATH_RULE[text(v.main_character_death)] ?? DEATH_RULE["Only when I direct it"]),
    storyLengthRule(text(v.story_length)),
    "Keep every character true to their character file. Treat the setting and the pinned story notes as facts.",
  ].filter(Boolean);
  const how = "## How to write\n" + rules.map((r) => `- ${r}`).join("\n");
  // Spec 6.5: native prose, not a translation of the English instructions.
  const style = languageStyle(language, mainName, suggests);
  const native = style.length ? `## Writing in ${language}\n` + style.map((r) => `- ${r}`).join("\n") : "";
  const genre = "## Genre\n" + input.storyType.prompt.map((p) => `- ${p}`).join("\n");

  if (epilogue) {
    // Spec 5.5: one final chapter in a single pass, at the Short chapter length.
    const { target, unit } = chapterLimits("Short", language);
    return [
      `You are a novelist finishing an interactive ${input.storyType.name.toLowerCase()} novel written together with the user.`,
      `Write the epilogue: the story's final chapter, in one piece, about ${target} ${unit} long. It carries on from where the last chapter ended.`,
      epilogue.mainCharacterDied
        ? `The main character, ${mainName}, died at the end of the last chapter. Show the world and the people they leave behind, and what their life meant.`
        : `Bring the story to its close: show where ${mainName} and the people around them end up.`,
      how,
      ...(native ? [native] : []),
      genre,
      // Spec 13.2: a happy or sad ending can bring in its music too.
      input.pictures
        ? `## Answer format\nWrite only the epilogue's text, as plain prose with no title or heading. Then, on a line of its own, \`MOOD: triumphant\` if the story ends happily, \`MOOD: sad\` if it ends in loss, otherwise \`MOOD: none\`.\n${PICTURE_RULE}\nWrite nothing after the picture line. Keep the words MOOD and PICTURE and the mood in English.`
        : "## Answer format\nWrite only the epilogue's text, as plain prose with no title or heading. Then, on a line of its own, `MOOD: triumphant` if the story ends happily, `MOOD: sad` if it ends in loss, otherwise `MOOD: none`, and nothing after it. Keep the word MOOD and the mood in English.",
    ].join("\n\n");
  }

  return [
    `You are a novelist writing an interactive ${input.storyType.name.toLowerCase()} novel together with the user, one block at a time.`,
    "Each answer is the next block of the current chapter: about 300 to 500 words of story that carries straight on from the chapter so far. Do not repeat, retell or summarise what has already happened. Every block brings something new: a place, a fact, a choice or a consequence. Follow the user's direction for this block.",
    how,
    ...(native ? [native] : []),
    genre,
    (suggests
      ? [
          "## Answer format",
          "Write the story text first, as plain prose with no title or heading. Then this exact line:",
          NEXT_MARKER,
          `Then two or three short suggested actions for what the main character could do next, one per line, in ${language}. After each action write " | " and a note of a few words, also in ${language}, on what it might do to the story, e.g. "raises the stakes with a rival".`,
          "Then the line `MAIN CHARACTER DIED: yes` if the main character died in this block, otherwise `MAIN CHARACTER DIED: no`.",
          MOOD_RULE,
          ...(input.pictures ? [PICTURE_RULE] : []),
          `Never leave out the line ${NEXT_MARKER}: without it the suggested actions are lost. Keep it, the words MAIN CHARACTER DIED and the mood line${input.pictures ? " and the picture line" : ""} in English.`,
        ]
      : [
          "## Answer format",
          "Write the story text first, as plain prose with no title or heading. Then this exact line:",
          NEXT_MARKER,
          "Then the line `MAIN CHARACTER DIED: yes` if the main character died in this block, otherwise `MAIN CHARACTER DIED: no`.",
          MOOD_RULE,
          ...(input.pictures ? [PICTURE_RULE] : []),
          `Write nothing after the ${input.pictures ? "picture" : "mood"} line. Do not suggest what could happen next: the user decides every block.`,
          `Keep the line ${NEXT_MARKER}, the words MAIN CHARACTER DIED and the mood line${input.pictures ? " and the picture line" : ""} in English.`,
        ]
    ).join("\n"),
  ].join("\n\n");
}

function settingFile(input: PromptInput): string {
  const fields = settingFields(input.storyType);
  const values = localizeChoices(fields, input.setting.values, choiceLocale(input));
  const header = headerFromValues(fields, values, new Set(), input.setting.extra);
  return formatMarkDoc({ header, body: input.setting.background }).trim();
}

function characterFile(input: PromptInput, c: Character, detail: Budget["characterDetail"]): string {
  const fields = characterFields(input.storyType);
  const values = localizeChoices(fields, c.values, choiceLocale(input));
  const header = headerFromValues(fields, values, hiddenKeys(fields, c.isMain), c.extra);
  const body = detail === "full" ? c.background : "";
  const title = c.isMain ? `${characterName(c)} (main character)` : characterName(c);
  return `### ${title}\n${formatMarkDoc({ header, body }).trim()}`;
}

/** Layer 9: the direction, and where the story and the chapter stand. These change with every block, so they come last. */
function nextBlock(input: PromptInput): string {
  const v = input.setting.values;
  const lines: string[] = [];
  if (!input.epilogue) {
    lines.push(`Story arc: ${storyArcStage(text(v.story_length), input.chapter)}`);
    // Spec 5.3: steer toward an ending at the target; conclude at the hard limit.
    const { count, limits, stage } = chapterProgress(input.blocks, text(v.chapter_length), languageOf(input));
    lines.push(`Chapter length: ${count} of about ${limits.target} ${limits.unit} so far.`);
    if (stage === "soft") {
      lines.push("The chapter has reached its target length: steer toward a natural chapter ending in this block or the next.");
    }
    if (stage === "hard") {
      lines.push(
        hasSuggestions(input.storyType)
          ? "This block is the chapter's conclusion: bring the chapter to a natural close. Point the suggested actions toward the next chapter."
          : "This block is the chapter's conclusion: bring the chapter to a natural close.",
      );
    }
  }
  // Decision 65: the first block of any chapter may come without a direction.
  const none = input.epilogue
    ? "Direction: none given. Close the story in the way that fits it best."
    : input.blocks.length > 0
      ? "Direction: none given. Carry the chapter on in the way that fits it best."
      : input.chapter > 1
        ? "Direction: none given. Open the chapter where the previous one left off, with a situation the story has not had yet."
        : "Direction: none given. Open the chapter in a way that fits the setting and the main character.";
  lines.push(input.direction.trim() ? `Direction: ${input.direction.trim()}` : none);
  if (input.hint?.trim()) lines.push(`Hint for this version: ${input.hint.trim()}`);
  return lines.join("\n");
}

const USED_SCENES_RULE =
  "These scenes have already happened in this story. Do not stage them again in a new form; move the story to situations it has not had yet.";

/**
 * The newest lines of a list that fit in `tokens`, in their order. The End
 * Chapter call keeps the used scenes list under its cap; this only guards the
 * flat request size when it did not (spec 6.4).
 */
function newestWithin(lines: string[], tokens: number, language: string): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of [...lines].reverse()) {
    used += estimateTokens(line, language) + 1;
    if (used > tokens) break;
    out.unshift(line);
  }
  return out;
}

export function buildPrompt(input: PromptInput): Prompt {
  const budget = BUDGETS[input.budget] ?? BUDGETS.balanced;
  const summaries = (input.chapterSummaries ?? []).filter((s) => s.trim());
  const previousSummary = summaries.at(-1) ?? "";
  const tail = tailText(input.previousChapter ?? "", budget.previousTailWords, languageOf(input));
  const usedScenes = newestWithin(input.usedScenes ?? [], budget.usedScenesTokens, languageOf(input));

  const scene = charactersInScene(input.characters, [
    ...input.blocks,
    input.direction,
    input.hint ?? "",
    previousSummary,
    // Rich: also the characters named in the last 3 finished chapters (spec 6.2).
    ...(input.budget === "rich" ? (input.recentChapters ?? []).slice(-3) : []),
  ]);
  const main = input.characters.find((c) => c.isMain);
  const mainName = main ? characterName(main) : "the main character";

  const sections: [LayerId, string][] = [
    ["setting", `## Setting\n${settingFile(input)}`],
    ["notes", input.notes.length ? `## Pinned story notes\n${input.notes.map((n) => `- ${n}`).join("\n")}` : ""],
    [
      "characters",
      scene.length
        ? `## Characters in the scene\n${scene.map((c) => characterFile(input, c, budget.characterDetail)).join("\n\n")}`
        : "",
    ],
    ["story-so-far", input.storySummary?.trim() ? `## The story so far\n${input.storySummary.trim()}` : ""],
    ["used-scenes", usedScenes.length ? `## Scenes already used\n${USED_SCENES_RULE}\n${usedScenes.map((l) => `- ${l}`).join("\n")}` : ""],
    [
      "recent-chapters",
      summaries.length
        ? `## Recent chapters, oldest first\n${summaries.slice(-budget.recentSummaries).join("\n\n")}`
        : "",
    ],
    ["previous-tail", tail ? `## End of the previous chapter\n…${tail}` : ""],
    [
      "chapter",
      input.epilogue
        ? ""
        : `## Chapter ${input.chapter} so far\n` +
          (input.blocks.length ? input.blocks.join("\n\n") : "(Nothing yet. The next block opens the chapter.)"),
    ],
    ["direction", `## ${input.epilogue ? "The epilogue" : "Next block"}\n${nextBlock(input)}`],
  ];
  const sent = sections.filter(([, body]) => body);

  return {
    messages: [
      { role: "system", content: instructions(input, mainName) },
      { role: "user", content: sent.map(([, body]) => body).join("\n\n") },
    ],
    layers: ["instructions", ...sent.map(([id]) => id)],
    scene: scene.map(characterName),
  };
}
