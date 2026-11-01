/**
 * Renders a form from story type field definitions, one panel per section.
 * Used by the Setting page and the character form.
 */
import { ReactNode, useEffect, useId, useState } from "react";
import { fieldHint, fieldLabel, fieldPlaceholder, optionLabel, scaleLabels, sectionName, t } from "../i18n";
import { FieldDef, Rank, Values } from "../lib/fields";
import { LANGUAGES } from "../lib/storyTypes";

interface Props {
  fields: FieldDef[];
  values: Values;
  errors: Record<string, string>;
  required: Set<string>;
  hidden: Set<string>;
  rankOptions: string[];
  /** Options of each pick field, by key, from the setting's lists (pickOptionsFor). */
  pickOptions?: Record<string, string[]>;
  /** Lowest allowed age, shown on the age input. */
  minAge?: number;
  /** Values that "Reset" buttons go back to, e.g. the curated set's rank ladder; else the field default. */
  defaults?: Values;
  /** Extra controls shown under a field, by key, e.g. a Random name button (spec 7.1). */
  extras?: Record<string, ReactNode>;
  /** Keys shown but not editable, e.g. the language of a started story (decision 89). */
  readOnly?: Set<string>;
  onChange: (key: string, value: unknown) => void;
}

export default function FieldForm(props: Props) {
  // Ids are unique per form: the Setting and Characters tabs stay mounted side by side,
  // and the same key in both would give a label the wrong input.
  const idPrefix = useId();
  const visible = props.fields.filter((f) => !props.hidden.has(f.key));
  const sections: { name: string; fields: FieldDef[] }[] = [];
  for (const f of visible) {
    const s = sections.find((x) => x.name === f.section);
    if (s) s.fields.push(f);
    else sections.push({ name: f.section, fields: [f] });
  }

  return (
    <>
      {sections.map((s) => (
        <section key={s.name} className="panel">
          <h2>{sectionName(s.name)}</h2>
          {s.fields.map((f) => (
            <Field key={f.key} field={f} idPrefix={idPrefix} {...props} />
          ))}
        </section>
      ))}
    </>
  );
}

/** Moves focus to the first field marked invalid, after the errors have rendered. */
export function focusFirstError() {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(
      '[aria-invalid="true"] input, [aria-invalid="true"] button, input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"]',
    );
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  });
}

function Field({
  field,
  idPrefix,
  values,
  errors,
  required,
  rankOptions,
  pickOptions,
  minAge,
  defaults,
  extras,
  readOnly,
  onChange,
}: Props & { field: FieldDef; idPrefix: string }) {
  const id = `${idPrefix}f-${field.key}`;
  const error = errors[field.key];
  const value = values[field.key];
  const set = (v: unknown) => onChange(field.key, v);
  // Radio-style inputs are grouped in a fieldset with a legend; the rest use a label.
  const grouped = field.type === "multi" || (field.type === "choice" && showsAsSegments(field));

  const head = (
    <>
      {fieldLabel(field)}
      {required.has(field.key) && <span className="req">{t("form.required")}</span>}
    </>
  );

  const control = (() => {
    const common = {
      id,
      disabled: readOnly?.has(field.key) || undefined,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${id}-err` : undefined,
    };
    switch (field.type) {
      case "text":
        return <input {...common} value={String(value ?? "")} placeholder={fieldPlaceholder(field)} onChange={(e) => set(e.target.value)} />;
      case "longtext":
        return (
          <textarea {...common} rows={3} value={String(value ?? "")} placeholder={fieldPlaceholder(field)} onChange={(e) => set(e.target.value)} />
        );
      case "number": {
        const min = field.key === "age" && minAge !== undefined ? minAge : field.min;
        return (
          <input
            {...common}
            className="short"
            type="number"
            inputMode="numeric"
            min={min}
            max={field.max}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
          />
        );
      }
      case "list":
        // Kept as raw lines while typing, so Enter adds an empty line; empty lines are dropped on save.
        return (
          <textarea
            {...common}
            rows={Math.max(3, ((value as string[]) ?? []).length + 1)}
            value={((value as string[]) ?? []).join("\n")}
            placeholder={fieldPlaceholder(field)}
            onChange={(e) => set(e.target.value.split("\n"))}
          />
        );
      case "choice":
        if (showsAsSegments(field)) {
          return <Segments field={field} value={String(value ?? "")} onChange={set} />;
        }
        if (field.otherOption) {
          return <ChoiceWithOther field={field} common={common} value={String(value ?? "")} notSet={!required.has(field.key) || !value} onChange={set} />;
        }
        return (
          <select {...common} value={String(value ?? "")} onChange={(e) => set(e.target.value)}>
            {(!required.has(field.key) || !value) && <option value="">{t("form.notSet")}</option>}
            {!!value && !field.options?.includes(String(value)) && <option value={String(value)}>{String(value)}</option>}
            {field.options?.map((o) => (
              <option key={o} value={o}>
                {optionLabel(field, o)}
              </option>
            ))}
          </select>
        );
      case "multi":
        return <Chips field={field} value={(value as string[]) ?? []} onChange={set} />;
      case "scale":
        return <Scale id={id} field={field} value={Number(value)} onChange={set} />;
      case "rank": {
        const v = String(value ?? "");
        return (
          <select {...common} value={v} onChange={(e) => set(e.target.value)}>
            <option value="">{t("form.notSet")}</option>
            {v && !rankOptions.includes(v) && <option value={v}>{t("form.notInLadder", { rank: v })}</option>}
            {rankOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      }
      case "pick": {
        const v = String(value ?? "");
        const options = pickOptions?.[field.key] ?? [];
        return (
          <select {...common} value={v} onChange={(e) => set(e.target.value)}>
            <option value="">{t("form.notSet")}</option>
            {v && !options.includes(v) && <option value={v}>{v}</option>}
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      }
      case "ladder":
        return <LadderEditor field={field} value={(value as Rank[]) ?? []} reset={(defaults?.[field.key] ?? field.default) as Rank[] | undefined} onChange={set} />;
      case "language":
        return <LanguagePicker id={id} value={String(value ?? "")} disabled={readOnly?.has(field.key)} onChange={set} />;
    }
  })();

  const hint = field.type === "rank" && rankOptions.length === 0 ? t("form.emptyLadder") : fieldHint(field);
  const foot = (
    <>
      {extras?.[field.key]}
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </>
  );

  if (grouped || field.type === "ladder") {
    return (
      <fieldset className="field" aria-invalid={error ? true : undefined}>
        <legend>{head}</legend>
        {control}
        {foot}
      </fieldset>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{head}</label>
      {control}
      {foot}
    </div>
  );
}

/**
 * A choice whose "Other" opens a text box (decision 105). A value outside the
 * options is a typed one, so the dropdown shows Other with the text below it.
 */
function ChoiceWithOther({
  field,
  common,
  value,
  notSet,
  onChange,
}: {
  field: FieldDef;
  common: { id: string; disabled?: boolean; "aria-invalid"?: boolean; "aria-describedby"?: string };
  value: string;
  notSet: boolean;
  onChange: (v: string) => void;
}) {
  const other = field.otherOption!;
  const listed = (v: string) => v === "" || (v !== other && !!field.options?.includes(v));
  // The box stays open while typing, also when the text so far is an option ("Mage" on the
  // way to "Mage hunter"): what the user typed is kept here, not worked out from the value (CR-02).
  const [open, setOpen] = useState(!listed(value));
  const [text, setText] = useState(value === other || listed(value) ? "" : value);
  // A value set from outside (the set's main character, Randomize) decides again.
  useEffect(() => {
    if (value === (text || other)) return;
    setOpen(!listed(value));
    setText(value === other || listed(value) ? "" : value);
    // Only a change of the value from outside matters here.
  }, [value]);

  // While the box is open the error belongs to it, so a failed save focuses the box (CR-10).
  const { "aria-invalid": invalid, ...rest } = common;
  return (
    <>
      <select
        {...rest}
        aria-invalid={open ? undefined : invalid}
        value={open ? other : value}
        onChange={(e) => {
          const v = e.target.value;
          setOpen(v === other);
          setText("");
          onChange(v);
        }}
      >
        {notSet && <option value="">{t("form.notSet")}</option>}
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {optionLabel(field, o)}
          </option>
        ))}
      </select>
      {open && (
        <input
          className="other-input"
          aria-label={t("form.otherText", { label: fieldLabel(field) })}
          aria-invalid={invalid}
          aria-describedby={common["aria-describedby"]}
          disabled={common.disabled}
          autoFocus={value === other}
          value={text}
          placeholder={t("form.otherPlaceholder")}
          onChange={(e) => {
            setText(e.target.value);
            // Emptied again, the field goes back to Other, which the form check asks to fill.
            onChange(e.target.value.trim() === "" ? other : e.target.value);
          }}
        />
      )}
    </>
  );
}

/** Short option lists read better as a row of buttons than as a dropdown. */
function showsAsSegments(field: FieldDef): boolean {
  const options = field.options ?? [];
  return !!field.required && options.length <= 3 && options.every((o) => o.length <= 30);
}

function Segments({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className="segmented wrap">
      {field.options?.map((o) => (
        <label key={o} className={value === o ? "seg selected" : "seg"}>
          <input type="radio" name={field.key} value={o} checked={value === o} onChange={() => onChange(o)} />
          {optionLabel(field, o)}
        </label>
      ))}
    </div>
  );
}

function Chips({ field, value, onChange }: { field: FieldDef; value: string[]; onChange: (v: string[]) => void }) {
  const full = field.max !== undefined && value.length >= field.max;
  return (
    <div className="chips">
      {field.options?.map((o) => {
        const on = value.includes(o);
        return (
          <label key={o} className={`chip${on ? " selected" : ""}${!on && full ? " disabled" : ""}`}>
            <input
              type="checkbox"
              checked={on}
              disabled={!on && full}
              onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            />
            {optionLabel(field, o)}
          </label>
        );
      })}
    </div>
  );
}

function Scale({ id, field, value, onChange }: { id: string; field: FieldDef; value: number; onChange: (v: number) => void }) {
  const min = field.min ?? 1;
  const max = field.max ?? 5;
  const labels = scaleLabels(field);
  return (
    <div className="scale">
      <span className="scale-end">{labels.min ?? min}</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : min}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="scale-end">{labels.max ?? max}</span>
      <output htmlFor={id} className="scale-value">
        {Number.isFinite(value) ? value : min}
      </output>
    </div>
  );
}

function LadderEditor({
  value,
  reset,
  onChange,
}: {
  field: FieldDef;
  value: Rank[];
  /** The ladder "Reset" goes back to: the story's set in the novel's language. */
  reset?: Rank[];
  onChange: (v: Rank[]) => void;
}) {
  const update = (i: number, patch: Partial<Rank>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => {
    const next = [...value];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  return (
    <div className="ladder">
      {value.length > 0 && (
        <div className="ladder-row ladder-head" aria-hidden="true">
          <span />
          <span>{t("ladder.rank")}</span>
          <span>{t("ladder.stages")}</span>
          <span />
        </div>
      )}
      {value.map((r, i) => (
        <div key={i} className="ladder-row">
          <span className="ladder-num">{i + 1}</span>
          <input aria-label={t("ladder.rankName", { n: i + 1 })} value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
          <input
            aria-label={t("ladder.rankStages", { n: i + 1 })}
            value={r.stages.join(",")}
            placeholder={t("ladder.noStages")}
            // Split without trimming, so typing "Early, " is not changed under the cursor. Trimmed on save.
            onChange={(e) => update(i, { stages: e.target.value === "" ? [] : e.target.value.split(",") })}
          />
          <span className="ladder-tools">
            <button type="button" className="icon-btn" aria-label={t("ladder.up", { n: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("ladder.down", { n: i + 1 })}
              disabled={i === value.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("ladder.remove", { n: i + 1 })}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn small" onClick={() => onChange([...value, { name: "", stages: [] }])}>
          {t("ladder.add")}
        </button>
        {reset !== undefined && (
          <button type="button" className="btn small" onClick={() => onChange(structuredClone(reset))}>
            {t("ladder.reset")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The novel's language: the three of decision 71. A story from before phase 6
 * may hold another; it stays pickable so the story keeps working.
 */
function LanguagePicker({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const earlier = value !== "" && !LANGUAGES.includes(value);
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {earlier && <option value={value}>{t("language.earlier", { language: value })}</option>}
      {LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}
