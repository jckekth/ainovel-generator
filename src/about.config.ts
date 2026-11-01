/**
 * The About page's fixed values (spec 10, decisions 79, 80, 94, 107). Not user
 * settings: they change only with a new build. A value still holding a
 * placeholder stops the installer build (scripts/check-about.mjs), so no
 * release ships one; development builds and tests run with them.
 */
export const ABOUT = {
  author: "JC Do Things",
  email: "jc.do.things@gmail.com",
  /** The app's itch.io page: downloads, updates, bug reports and donations. */
  homePage: "https://jc-do-things.itch.io/ai-novel-generator-tool",
  /** One switch per link, for a store whose rules forbid it (spec 10). */
  showHomePage: true,
};

/** Values that are not real yet. The installer build stops while any is left. */
export const PLACEHOLDERS = ["example.itch.io", "example.com", "TODO"];

/**
 * The placeholders still in the About values, for the installer check. It reads
 * the values themselves, so a change in how this file is written cannot hide
 * one (CR-07).
 */
export function placeholdersLeft(values: Record<string, unknown> = ABOUT): string[] {
  const text = Object.values(values).filter((v): v is string => typeof v === "string");
  return PLACEHOLDERS.filter((p) => text.some((v) => v.includes(p)));
}

/** The art and font credits (spec 10): name, source and licence. */
export const CREDITS = [
  { name: "Tauri", by: "the Tauri Programme", licence: "MIT or Apache-2.0" },
  { name: "React", by: "Meta", licence: "MIT" },
  { name: "Literata", by: "TypeTogether", licence: "SIL Open Font License" },
  { name: "Phosphor Icons", by: "Phosphor", licence: "MIT" },
];
