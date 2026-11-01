/**
 * Notes that keep the prose native to the novel's language (spec 6.5, decision 70).
 *
 * Every instruction is in English, so without these a model tends to plan in
 * English and translate as it writes: English word order, English jokes and
 * metaphors, and suggested actions phrased as requests ("請陳美…").
 * Notes for one language are written in that language, which also nudges the
 * model to think in it.
 */

/** A language's own notes: style, and how to phrase a suggested action (`main` is the main character's name). */
const NOTES: Record<string, { style: string[]; action: (main: string) => string }> = {
  "简体中文 (Simplified Chinese)": {
    style: [
      "用地道的简体中文写作，像以简体中文为母语的小说作者，而不是翻译英文：用中文的语序和节奏，句子简洁，少用长串修饰语。",
      "避免翻译腔：不要堆叠“的”，少用“被”字句和“当……的时候”，不要每句都以“他”“她”开头。",
      "对话要口语自然，符合人物身份；幽默和比喻要用中文读者熟悉的说法，不要直译英文的笑话或比喻。",
      "对话用“”。",
    ],
    action: (main) =>
      `建议行动写成主角接下来要做的事，以主角名字或动作开头，例如“${main}去问个清楚”；不要用“请”或“让”开头。`,
  },
  "繁體中文 (Traditional Chinese)": {
    style: [
      "用道地的繁體中文寫作，像以繁體中文為母語的小說作者，而不是翻譯英文：用中文的語序和節奏，句子簡潔，少用長串修飾語。",
      "避免翻譯腔：不要堆疊「的」，少用「被」字句和「當……的時候」，不要每句都以「他」「她」開頭。",
      "對話要口語自然，符合人物身分；幽默和比喻要用中文讀者熟悉的說法，不要直譯英文的笑話或比喻。",
      "對話用「」。",
    ],
    action: (main) =>
      `建議行動寫成主角接下來要做的事，以主角名字或動作開頭，例如「${main}去問個清楚」；不要用「請」或「讓」開頭。`,
  },
};

/**
 * Style rules for writing in `language`. English needs none; any other
 * language gets the general rule, plus its own notes when there are some.
 * `actions`: the answer also has suggested actions (blocks, not the epilogue).
 */
export function languageStyle(language: string, mainName: string, actions: boolean): string[] {
  if (!language.trim() || /^english$/i.test(language.trim())) return [];
  return [
    `Write as a native ${language} novelist, not as a translation from English: the natural word order, rhythm, idioms and dialogue of ${language}, with humour and images that work in ${language}.`,
    ...(NOTES[language]?.style ?? []),
    ...(actions && NOTES[language] ? [NOTES[language].action(mainName)] : []),
  ];
}
