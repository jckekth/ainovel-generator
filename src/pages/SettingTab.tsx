import { useEffect, useId, useMemo, useState } from "react";
import { FloppyDiskIcon, ShuffleIcon } from "@phosphor-icons/react";
import FieldForm, { focusFirstError } from "../components/FieldForm";
import { t, tType } from "../i18n";
import { applySet, getSet, randomSet, setValues, switchSetLanguage } from "../lib/curatedSets";
import { normalize, rankOptions, validate } from "../lib/fields";
import { isSettingLocked, ladderOf, loadNotes, loadSetting, saveNotes, saveSetting, SettingDoc } from "../lib/setting";
import { Story } from "../lib/stories";
import { getStoryType, settingFields } from "../lib/storyTypes";
import { errorText } from "../lib/errors";

interface Props {
  story: Story;
  /** Changes whenever the draft changes, so the lock is checked again (spec 8.1). */
  draftVersion: number;
  /** True while a block is being written: the chapter has started, so the setting is locked already (spec 8.1). */
  writing: boolean;
  onSaved: (story: Story) => void;
  /** Told whether the setting has unsaved edits, so leaving the story can ask first (spec 9). */
  onDirtyChange?: (dirty: boolean) => void;
}

type Result = { kind: "ok" | "error"; text: string } | null;

function message(e: unknown) {
  return errorText(e);
}

export default function SettingTab({ story, draftVersion, writing, onSaved, onDirtyChange }: Props) {
  const fields = useMemo(() => settingFields(getStoryType(story.type)), [story.type]);
  const backgroundId = useId();
  const [doc, setDoc] = useState<SettingDoc | null>(null);
  const [draftLocked, setDraftLocked] = useState(false);
  // The draft has no blocks until the first one arrives in full (decision 38), so a block
  // being written locks the setting too; otherwise a change could slip in mid-block.
  const locked = draftLocked || writing;
  // Decision 89: from the first block on, the language is fixed and Randomize is gone.
  const started = story.chapterCount > 0 || locked;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  useEffect(() => {
    (async () => {
      try {
        setDoc(await loadSetting(story));
      } catch (e) {
        setLoadError(message(e));
      }
    })();
    // Loaded once per story; saving updates the local copy.
  }, [story.id]);

  useEffect(() => {
    isSettingLocked(story.id).then(setDraftLocked, () => setDraftLocked(false));
  }, [story.id, draftVersion]);

  if (loadError) return <div className="notice error">{t("setting.readError", { error: loadError })}</div>;
  if (!doc) return <p className="muted">{t("common.loading")}</p>;

  const required = new Set(fields.filter((f) => f.required).map((f) => f.key));
  const set = getSet(story.type, doc.setId);
  const language = String(doc.values.language || story.language);
  const edit = (patch: Partial<SettingDoc>) => {
    setDoc({ ...doc, ...patch });
    setDirty(true);
    setResult(null);
  };

  /** A field changed. A new novel language brings the set's text in that language, where untouched (spec 8). */
  function change(key: string, value: unknown) {
    if (!doc) return;
    const values = { ...doc.values, [key]: value };
    if (key === "language" && set && typeof value === "string" && value) {
      edit(switchSetLanguage(values, doc.background, set, language, value));
    } else {
      edit({ values });
    }
  }

  /** Another curated set of this type, never the one shown (spec 8, decision 85). */
  function randomize() {
    if (!doc) return;
    const next = randomSet(story.type, doc.setId);
    if (!next) return;
    setErrors({});
    edit({ ...applySet(doc.values, next, language), setId: next.id });
  }

  async function save() {
    if (!doc) return;
    const values = normalize(fields, doc.values);
    const errs = validate(fields, values, { required, hidden: new Set(), rankOptions: rankOptions(ladderOf(values)) });
    if (!doc.background.trim()) errs.background = t("setting.backgroundRequired");
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setResult({ kind: "error", text: t("form.needsAttention") });
      focusFirstError();
      return;
    }
    setBusy(true);
    try {
      const saved = { ...doc, values, saved: true };
      onSaved(await saveSetting(story, saved));
      setDoc(saved);
      setDirty(false);
      setResult({ kind: "ok", text: t("setting.saved") });
    } catch (e) {
      setResult({ kind: "error", text: t("setting.saveError", { error: message(e) }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!doc.saved && (
        <div className="notice guide">
          <strong>{t("setting.guideTitle")}</strong> {tType("setting.guideText", story.type)}
        </div>
      )}
      {locked && <div className="notice">{t("setting.locked")}</div>}

      <fieldset className="plain" disabled={locked}>
        <section className="panel">
          <div className="panel-head">
            <h2>{t("setting.world")}</h2>
            {set && !started && (
              <button type="button" className="btn" onClick={randomize} title={t("setting.randomizeHint")}>
                <ShuffleIcon className="btn-icon" aria-hidden />
                {t("setting.randomize")}
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor={backgroundId}>
              {t("setting.background")}
              <span className="req">{t("form.required")}</span>
            </label>
            <textarea
              id={backgroundId}
              rows={8}
              className="reading-input"
              value={doc.background}
              aria-invalid={errors.background ? true : undefined}
              placeholder={tType("setting.backgroundPlaceholder", story.type)}
              onChange={(e) => edit({ background: e.target.value })}
            />
            {errors.background && <p className="field-error">{errors.background}</p>}
          </div>
        </section>

        <FieldForm
          fields={fields}
          values={doc.values}
          errors={errors}
          required={required}
          hidden={new Set()}
          rankOptions={[]}
          defaults={set ? setValues(set, language) : undefined}
          readOnly={started ? new Set(["language"]) : undefined}
          extras={started ? { language: <p className="hint">{t("setting.languageFixed")}</p> } : undefined}
          onChange={change}
        />
      </fieldset>

      <div className="savebar">
        {result && <p className={`result ${result.kind}`}>{result.text}</p>}
        {!result && dirty && <p className="result muted">{t("common.unsaved")}</p>}
        <button className="btn primary" onClick={save} disabled={locked || busy || (!dirty && doc.saved)}>
          <FloppyDiskIcon className="btn-icon" aria-hidden />
          {t("setting.save")}
        </button>
      </div>

      <NotesPanel storyId={story.id} typeId={story.type} />
    </>
  );
}

/** Pinned story notes: short facts that are always sent with the prompt. Editable at any time. */
function NotesPanel({ storyId, typeId }: { storyId: string; typeId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<Result>(null);

  useEffect(() => {
    loadNotes(storyId)
      .then((notes) => setText(notes.join("\n")))
      .catch((e) => setResult({ kind: "error", text: t("notes.readError", { error: message(e) }) }));
  }, [storyId]);

  async function save() {
    try {
      const notes = (text ?? "").split("\n").map((n) => n.trim()).filter(Boolean);
      await saveNotes(storyId, notes);
      setText(notes.join("\n"));
      setDirty(false);
      setResult({ kind: "ok", text: t("notes.saved") });
    } catch (e) {
      setResult({ kind: "error", text: t("notes.saveError", { error: message(e) }) });
    }
  }

  return (
    <section className="panel notes">
      <h2>{t("notes.title")}</h2>
      <p className="muted">{t("notes.text")}</p>
      <textarea
        aria-label={t("notes.title")}
        rows={5}
        value={text ?? ""}
        disabled={text === null}
        placeholder={tType("notes.placeholder", typeId)}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
          setResult(null);
        }}
      />
      <div className="row end">
        {result && <p className={`result ${result.kind}`}>{result.text}</p>}
        <button className="btn" onClick={save} disabled={!dirty}>
          <FloppyDiskIcon className="btn-icon" aria-hidden />
          {t("notes.save")}
        </button>
      </div>
    </section>
  );
}
