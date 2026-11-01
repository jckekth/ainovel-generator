/**
 * Story art (spec 12.3, decisions 97, 98, 103, 112): one background per story
 * type and three character figures shared by all types, shipped as fixed
 * files in src/assets/. A missing file gives undefined, and the page then
 * shows its plain colour instead.
 */
// General's background is an abstract SVG made in code, not a picture of a world (decision 127).
const backgrounds = import.meta.glob<string>("../assets/backgrounds/*.{webp,svg}", { eager: true, query: "?url", import: "default" });
const figures = import.meta.glob<string>("../assets/figures/*.png", { eager: true, query: "?url", import: "default" });

export type FigureKind = "male" | "female" | "neutral";

/** The story type's background image, e.g. src/assets/backgrounds/romance.webp or general.svg. */
export function backgroundUrl(typeId: string): string | undefined {
  return backgrounds[`../assets/backgrounds/${typeId}.webp`] ?? backgrounds[`../assets/backgrounds/${typeId}.svg`];
}

/** Male and Female have their own figure; Non-binary, Other and no gender show the neutral one. */
export function figureKind(gender: unknown): FigureKind {
  if (gender === "Male") return "male";
  if (gender === "Female") return "female";
  return "neutral";
}

export function figureUrl(gender: unknown): string | undefined {
  return figures[`../assets/figures/figure-${figureKind(gender)}.png`];
}

/**
 * Background strength per story type (decision 98). 0.6 for all; a type whose
 * image fails the contrast check gets a lower value here.
 */
const STRENGTH: Record<string, number> = {};

export function backgroundStrength(typeId: string): number {
  return STRENGTH[typeId] ?? 0.6;
}
