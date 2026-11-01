import { fieldLabel, Locale, optionLabel, optionValue, t } from "../i18n";
/**
 * Form fields defined by the story type config files (src/storyTypes/*.json).
 *
 * The Setting and Character pages build their forms from these definitions,
 * and the same keys are used in the YAML header of setting.md and character files.
 */

export type FieldType =
  | "text"
  | "longtext"
  | "number"
  | "choice"
  | "multi"
  | "list"
  | "scale"
  /** A choice from the story's rank ladder. */
  | "rank"
  /** The rank ladder itself: ordered ranks, each with sub-stages. */
  | "ladder"
  /** The novel's language: a known language or a typed one. */
  | "language"
  /**
   * A choice from one of the setting's lists, named by `from` (fantasy race and
   * adventurer rank, decisions 101, 104). Lenient: a value no longer in the list
   * is kept as saved, since the list can change between chapters.
   */
  | "pick";

export interface FieldDef {
  /** Key in the YAML header. snake_case so the file reads well. */
  key: string;
  label: string;
  type: FieldType;
  /** Fields with the same section are shown together under this heading. */
  section: string;
  hint?: string;
  placeholder?: string;
  options?: string[];
  /** number and scale: lowest value. */
  min?: number;
  /** number and scale: highest value. multi: most options that can be picked. */
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  default?: unknown;
  required?: boolean;
  /** Not shown for the main character, e.g. "relationship with the main character". */
  hideForMain?: boolean;
  /** pick: the key of the setting list the options come from. */
  from?: string;
  /** pick: not shown while that list is empty and nothing is saved (adventurer rank, decision 104). */
  hideWhenEmpty?: boolean;
  /**
   * choice: the option that opens a text box (decision 105). The typed text is
   * what is saved; the option itself is saved only while nothing is typed yet.
   */
  otherOption?: string;
}

export interface Rank {
  name: string;
  stages: string[];
}

export type Values = Record<string, unknown>;

export function defaultValue(field: FieldDef): unknown {
  if (field.default !== undefined) return structuredClone(field.default);
  switch (field.type) {
    case "number":
      return null;
    case "multi":
    case "list":
    case "ladder":
      return [];
    case "scale": {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      return Math.round((min + max) / 2);
    }
    default:
      return "";
  }
}

export function defaultValues(fields: FieldDef[]): Values {
  return Object.fromEntries(fields.map((f) => [f.key, defaultValue(f)]));
}

function asStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => x !== null && x !== undefined).map(String);
  if (typeof raw === "string" && raw.trim()) return [raw];
  return [];
}

/**
 * Turns a value read from a YAML header into the shape the form expects.
 * The files can be edited by hand, so anything unexpected falls back to the default.
 */
export function coerce(field: FieldDef, raw: unknown): unknown {
  if (raw === undefined || raw === null) return defaultValue(field);
  // An object where a value belongs (an AI answer such as {"name": "Mage"}) is not text (CR-03).
  if (typeof raw === "object" && !Array.isArray(raw) && field.type !== "ladder") return defaultValue(field);
  switch (field.type) {
    case "number":
    case "scale": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? n : defaultValue(field);
    }
    case "multi":
    case "list":
      return asStringList(raw);
    case "ladder":
      if (!Array.isArray(raw)) return defaultValue(field);
      return raw
        .map((r): Rank | null => {
          if (typeof r === "string") return { name: r, stages: [] };
          if (r && typeof r === "object" && "name" in r) {
            return { name: String(r.name ?? ""), stages: asStringList((r as Rank).stages) };
          }
          return null;
        })
        .filter((r): r is Rank => r !== null);
    default:
      return Array.isArray(raw) ? raw.join(", ") : String(raw);
  }
}

/** Tidies values before they are validated and saved: trims text, drops empty list lines. */
export function normalize(fields: FieldDef[], values: Values): Values {
  const out: Values = { ...values };
  for (const f of fields) {
    const v = values[f.key];
    switch (f.type) {
      case "text":
      case "longtext":
      case "choice":
      case "rank":
      case "language":
      case "pick":
        out[f.key] = typeof v === "string" ? v.trim() : "";
        break;
      case "number":
        out[f.key] = typeof v === "number" && Number.isFinite(v) ? v : null;
        break;
      case "list":
      case "multi":
        out[f.key] = asStringList(v)
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "ladder":
        out[f.key] = ((v as Rank[]) ?? [])
          .map((r) => ({
            name: r.name.trim(),
            stages: r.stages.map((s) => s.trim()).filter(Boolean),
          }))
          .filter((r) => r.name);
        break;
    }
  }
  return out;
}

/**
 * Choice values (choice and multi fields) in a language, e.g. for the AI in
 * the novel's language (spec 6.5, decision 84). Other values are unchanged.
 */
export function localizeChoices(fields: FieldDef[], values: Values, locale: Locale): Values {
  if (locale === "en") return values;
  const out: Values = { ...values };
  for (const f of fields) {
    if (!f.options) continue;
    const v = values[f.key];
    if (typeof v === "string" && v) out[f.key] = optionLabel(f, v, locale);
    else if (Array.isArray(v)) out[f.key] = v.map((x) => (typeof x === "string" ? optionLabel(f, x, locale) : x));
  }
  return out;
}

/** The reverse of localizeChoices for one value the AI wrote: back to the saved English values (decision 84). */
export function choiceToEnglish(field: FieldDef, raw: unknown): unknown {
  if (!field.options) return raw;
  if (typeof raw === "string") return optionValue(field, raw);
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === "string" ? optionValue(field, x) : x));
  return raw;
}

/**
 * The options of a pick field: one per line of the setting list, the name
 * before a colon ("Elves: long-lived forest folk" gives "Elves").
 */
export function pickOptions(lines: unknown): string[] {
  const names = asStringList(lines)
    .map((line) => line.split(/[:：]/)[0].trim())
    .filter(Boolean);
  return [...new Set(names)];
}

/** Every pick field's options from the setting's values, by field key. */
export function pickOptionsFor(fields: FieldDef[], setting: Values): Record<string, string[]> {
  return Object.fromEntries(
    fields.filter((f) => f.type === "pick" && f.from).map((f) => [f.key, pickOptions(setting[f.from!])]),
  );
}

/** Every rank and stage as one pickable option, e.g. "Qi Refining, Early". */
export function rankOptions(ladder: Rank[]): string[] {
  return ladder.flatMap((r) =>
    r.stages.length === 0 ? [r.name] : r.stages.map((s) => `${r.name}, ${s}`),
  );
}

export interface ValidationContext {
  /** Keys that must be filled in. */
  required: Set<string>;
  /** Keys not shown, so not checked. */
  hidden: Set<string>;
  rankOptions: string[];
  /**
   * When given, a pick value must be one of its list: for what the AI proposes
   * (CR-01). The forms leave it out, so a value no longer listed stays as saved.
   */
  pickOptions?: Record<string, string[]>;
  /** Lowest allowed value of the "age" field, if the story type sets one. */
  minAge?: number;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Splits a file's YAML header into form values and any keys the form does not know. */
export function valuesFromHeader(fields: FieldDef[], header: Record<string, unknown>) {
  const known = new Set(fields.map((f) => f.key));
  const values: Values = {};
  for (const f of fields) values[f.key] = coerce(f, header[f.key]);
  const extra = Object.fromEntries(Object.entries(header).filter(([k]) => !known.has(k)));
  return { values, extra };
}

/**
 * Builds a YAML header in field order. Hidden fields are left out. Keys the
 * form does not know (added by hand, or by a newer version) are kept at the end.
 */
export function headerFromValues(
  fields: FieldDef[],
  values: Values,
  hidden: Set<string>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  for (const f of fields) {
    if (!hidden.has(f.key)) header[f.key] = values[f.key] ?? null;
  }
  return { ...header, ...extra };
}

/** Returns an error message per invalid field key. Expects normalized values. */
export function validate(fields: FieldDef[], values: Values, ctx: ValidationContext) {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (ctx.hidden.has(f.key)) continue;
    const v = values[f.key];

    if (f.key === "age" && ctx.minAge !== undefined) {
      if (typeof v !== "number") errors[f.key] = t("check.ageMissing", { min: String(ctx.minAge) });
      else if (v < ctx.minAge) errors[f.key] = t("check.ageLow", { min: String(ctx.minAge) });
      continue;
    }

    if (isEmpty(v)) {
      if (ctx.required.has(f.key)) {
        errors[f.key] = f.type === "ladder" ? t("check.ladder") : t("check.required", { label: fieldLabel(f) });
      }
      continue;
    }

    if (f.type === "number" && typeof v === "number") {
      if (!Number.isInteger(v)) errors[f.key] = t("check.whole");
      else if (f.min !== undefined && v < f.min) errors[f.key] = t("check.min", { min: String(f.min) });
      else if (f.max !== undefined && v > f.max) errors[f.key] = t("check.max", { max: String(f.max) });
    }
    if (f.type === "multi" && f.max !== undefined && (v as string[]).length > f.max) {
      errors[f.key] = t("check.multi", { max: String(f.max) });
    }
    if (f.type === "rank" && !ctx.rankOptions.includes(v as string)) {
      errors[f.key] = t("check.rank");
    }
    if (f.type === "pick" && ctx.pickOptions && !(ctx.pickOptions[f.key] ?? []).includes(v as string)) {
      errors[f.key] = t("check.pick", { label: fieldLabel(f) });
    }
    if (f.type === "choice" && f.otherOption && v === f.otherOption) {
      errors[f.key] = t("check.otherText", { label: fieldLabel(f) });
    } else if (f.type === "choice" && f.options && !f.options.includes(v as string) && !f.otherOption) {
      errors[f.key] = t("check.choice");
    }
  }
  return errors;
}
