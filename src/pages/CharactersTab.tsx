import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowLeftIcon, PlusIcon, ShuffleIcon, TrashIcon, UserCheckIcon, UserIcon } from "@phosphor-icons/react";
import FieldForm, { focusFirstError } from "../components/FieldForm";
import Modal from "../components/Modal";
import { fieldLabel, optionLabel, t } from "../i18n";
import { tRich } from "../i18n/rich";
import { getSet, randomName } from "../lib/curatedSets";
import {
  Character,
  characterName,
  CharacterList,
  deleteCharacter,
  exampleMainCharacter,
  hiddenKeys,
  listCharacters,
  newCharacter,
  requiredKeys,
  saveCharacter,
} from "../lib/characters";
import { normalize, pickOptionsFor, rankOptions, validate, Values } from "../lib/fields";
import CharacterFigure from "../components/CharacterFigure";
import { ladderOf, loadSetting } from "../lib/setting";
import { Story } from "../lib/stories";
import { characterFields, getStoryType } from "../lib/storyTypes";
import { errorText } from "../lib/errors";

interface Props {
  story: Story;
  /** Settings → Appearance → Background art: the figure behind the sheet (spec 12.3). */
  artOn: boolean;
  /** Changes when the setting is saved, so the rank ladder and lists are read again. */
  settingVersion: number;
  onChanged: () => void;
}

function message(e: unknown) {
  return errorText(e);
}

export default function CharactersTab({ story, artOn, settingVersion, onChanged }: Props) {
  const [list, setList] = useState<CharacterList | null>(null);
  /** Undefined until read, so the set's main character is not checked against an empty setting. */
  const [setting, setSetting] = useState<Values | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Character | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await listCharacters(story));
    } catch (e) {
      setError(message(e));
    }
  }, [story]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    loadSetting(story)
      .then((s) => setSetting(s.values))
      .catch(() => setSetting({}));
    // The story object changes on every save; only the id and setting version matter here.
  }, [story.id, settingVersion]);

  if (error) return <div className="notice error">{t("characters.loadError", { error })}</div>;
  if (!list) return <p className="muted">{t("common.loading")}</p>;

  if (editing) {
    return (
      <CharacterForm
        story={story}
        initial={editing}
        setting={setting ?? {}}
        artOn={artOn}
        others={list.characters.filter((c) => c.id !== editing.id)}
        onDone={async (changed) => {
          setEditing(null);
          if (changed) {
            await refresh();
            onChanged();
          }
        }}
      />
    );
  }

  const type = getStoryType(story.type);
  const hasMain = list.characters.some((c) => c.isMain);

  return (
    <>
      <div className="page-head compact">
        <div>
          <h2>{t("characters.title")}</h2>
          <p className="muted">{hasMain ? t("characters.editsApply") : t("characters.needMain")}</p>
        </div>
        <div className="row wrap">
          {!hasMain && (
            <button className="btn primary" onClick={() => setEditing(newCharacter(type, true, exampleMainCharacter(story, setting)))}>
              <UserIcon className="btn-icon" aria-hidden />
              {t("characters.createMain")}
            </button>
          )}
          <button className={hasMain ? "btn primary" : "btn"} onClick={() => setEditing(newCharacter(type, false))}>
            <PlusIcon className="btn-icon" aria-hidden />
            {t("characters.add")}
          </button>
        </div>
      </div>

      {list.unreadable.map((u) => (
        <div key={u.file} className="notice error">
          {t("characters.unreadable", { file: u.file, error: u.error })}
        </div>
      ))}

      {list.characters.length === 0 ? (
        <div className="empty">
          <p>{t("characters.empty")}</p>
        </div>
      ) : (
        <ul className="character-grid">
          {list.characters.map((c) => (
            <li key={c.id}>
              <button className={`character-card status-${String(c.values.status).toLowerCase()}`} onClick={() => setEditing(c)}>
                <span className="story-title">{displayName(c)}</span>
                <span className="story-meta">
                  {c.isMain && <span className="tag">{t("characters.mainTag")}</span>}
                  {c.values.status !== "Alive" && <span className="tag done">{statusLabel(type, c)}</span>}
                  {summaryLine(type, c) && <span>{summaryLine(type, c)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The name, or "Unnamed character" in the UI language. */
function displayName(c: Character): string {
  return String(c.values.name ?? "").trim() || t("characters.unnamed");
}

function statusLabel(type: ReturnType<typeof getStoryType>, c: Character): string {
  const field = characterFields(type).find((f) => f.key === "status");
  return field ? optionLabel(field, String(c.values.status)) : String(c.values.status);
}

/** One short line under the name: rank, class or occupation, and relationship. */
function summaryLine(type: ReturnType<typeof getStoryType>, c: Character): string {
  const v = c.values;
  // A listed class is shown in the UI language; a typed one as typed (CR-08).
  const classField = characterFields(type).find((f) => f.key === "class");
  const cls = typeof v.class === "string" && v.class !== "Other" && classField ? optionLabel(classField, v.class) : "";
  return [v.cultivation_rank, cls, v.occupation, c.isMain ? "" : v.relationship]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" · ");
}

/** The character form. Also used by the End Chapter review to edit a proposed new character first. */
export function CharacterForm({
  story,
  initial,
  setting,
  artOn = false,
  others = [],
  onDone,
  backLabel,
}: {
  story: Story;
  initial: Character;
  /** The story's setting values: the rank ladder and the lists pick fields choose from. */
  setting: Values;
  artOn?: boolean;
  /** The story's other characters, whose names Random name skips (spec 7.1). */
  others?: Character[];
  onDone: (changed: boolean) => void;
  backLabel?: string;
}) {
  const type = getStoryType(story.type);
  const fields = useMemo(() => characterFields(type), [type]);
  const backgroundId = useId();
  const [character, setCharacter] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
  const [nameNote, setNameNote] = useState<string | null>(null);
  const set = getSet(story.type, story.setId);

  const hidden = hiddenKeys(fields, character.isMain);
  const required = requiredKeys(type, fields, character.isMain);
  const ranks = rankOptions(ladderOf(setting));
  const picks = pickOptionsFor(fields, setting);
  // Decision 104: with no adventurer ranks in the setting, the field is not shown, unless one was saved.
  const shownHidden = new Set(hidden);
  for (const [key, options] of Object.entries(picks)) {
    const f = fields.find((x) => x.key === key);
    if (f?.hideWhenEmpty && options.length === 0 && !character.values[key]) shownHidden.add(key);
  }
  /** The idle figure holds still while a field on the sheet has focus (decision 111). */
  const [typing, setTyping] = useState(false);
  const isNew = character.id === "";

  const edit = (patch: Partial<Character>) => {
    setCharacter({ ...character, ...patch });
    setDirty(true);
    setSaveError(null);
    setNameNote(null);
  };

  /** A name from the set's pool that fits the gender and is not used yet (spec 7.1, decision 85). */
  function pickName() {
    if (!set) return;
    const name = randomName(set, story.language, character.values.gender, others.map(characterName), String(character.values.name ?? ""));
    if (name) edit({ values: { ...character.values, name } });
    else setNameNote(t("characters.noNames"));
  }

  /** The whole form as the set's main character (spec 7.1). */
  function useSetMain() {
    const example = exampleMainCharacter(story, setting);
    if (!example) return;
    setErrors({});
    // A pick the setting no longer lists is cleared, not kept from the form (QA-03).
    const cleared = Object.fromEntries(Object.keys(picks).map((k) => [k, ""]));
    edit({ values: { ...character.values, ...cleared, ...structuredClone(example.values) }, background: example.background });
  }

  async function save() {
    const values = normalize(fields, character.values);
    const errs = validate(fields, values, { required, hidden, rankOptions: ranks, minAge: type.rules.minAge });
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setSaveError(t("form.needsAttention"));
      focusFirstError();
      return;
    }
    setBusy(true);
    try {
      await saveCharacter(story, { ...character, values });
      onDone(true);
    } catch (e) {
      setSaveError(t("characters.saveError", { error: message(e) }));
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await deleteCharacter(story, character);
      onDone(true);
    } catch (e) {
      setConfirm(null);
      setSaveError(message(e));
    }
  }

  const back = () => (dirty ? setConfirm("discard") : onDone(false));
  const title = isNew ? (character.isMain ? t("characters.newMain") : t("characters.new")) : displayName(initial);

  return (
    <div
      className="character-sheet"
      onFocus={(e) => setTyping(e.target.matches("input, textarea, select"))}
      onBlur={() => setTyping(false)}
    >
      {artOn && <CharacterFigure gender={character.values.gender} still={typing} />}
      <button className="back" onClick={back}>
        <ArrowLeftIcon className="btn-icon" aria-hidden />
        {backLabel ?? t("characters.back")}
      </button>
      <div className="page-head compact">
        <div>
          <h2>{title}</h2>
          {character.isMain && (
            <p className="muted">
              {t("characters.mainNote")}
              {type.rules.mainCharacterRequired?.length
                ? " " +
                  t("characters.mustHave", {
                    fields: type.rules.mainCharacterRequired
                      .map((k) => {
                        const f = fields.find((x) => x.key === k);
                        return f ? fieldLabel(f) : k;
                      })
                      .join(", "),
                  })
                : ""}
            </p>
          )}
        </div>
        {character.isMain && set && (
          <button type="button" className="btn" onClick={useSetMain}>
            {/* Not random: it fills in the set's own main character (QA-07). */}
            <UserCheckIcon className="btn-icon" aria-hidden />
            {t("characters.useSetMain")}
          </button>
        )}
      </div>

      <FieldForm
        fields={fields}
        values={character.values}
        errors={errors}
        required={required}
        hidden={shownHidden}
        rankOptions={ranks}
        pickOptions={picks}
        minAge={type.rules.minAge}
        extras={
          set
            ? {
                name: (
                  <div className="row field-extra">
                    <button type="button" className="btn small" onClick={pickName}>
                      <ShuffleIcon className="btn-icon" aria-hidden />
                      {t("characters.randomName")}
                    </button>
                    {nameNote && <span className="hint">{nameNote}</span>}
                  </div>
                ),
              }
            : undefined
        }
        onChange={(key, value) => edit({ values: { ...character.values, [key]: value } })}
      />

      <section className="panel">
        <h2>{t("characters.background")}</h2>
        <div className="field">
          <label htmlFor={backgroundId}>{t("characters.backgroundLabel")}</label>
          <textarea
            id={backgroundId}
            rows={6}
            className="reading-input"
            value={character.background}
            placeholder={t("characters.backgroundPlaceholder")}
            onChange={(e) => edit({ background: e.target.value })}
          />
        </div>
      </section>

      <div className="savebar">
        {saveError && <p className="result error">{saveError}</p>}
        {!saveError && dirty && <p className="result muted">{t("common.unsaved")}</p>}
        {!isNew && !character.isMain && (
          <button className="btn danger-quiet" onClick={() => setConfirm("delete")}>
            <TrashIcon className="btn-icon" aria-hidden />
            {t("common.delete")}
          </button>
        )}
        <button className="btn" onClick={back}>
          {t("common.cancel")}
        </button>
        <button className="btn primary" onClick={save} disabled={busy || (!dirty && !isNew)}>
          {isNew ? t("characters.create") : t("characters.save")}
        </button>
      </div>

      {confirm === "discard" && (
        <Modal title={t("characters.discardTitle")} onClose={() => setConfirm(null)}>
          <p>{t("characters.discardText")}</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>
              {t("common.keepEditing")}
            </button>
            <button className="btn danger" onClick={() => onDone(false)}>
              {t("common.discardChanges")}
            </button>
          </div>
        </Modal>
      )}
      {confirm === "delete" && (
        <Modal title={t("characters.deleteTitle")} onClose={() => setConfirm(null)}>
          <p>{tRich("characters.deleteText", {}, { name: <strong>{displayName(initial)}</strong> })}</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>
              {t("characters.keep")}
            </button>
            <button className="btn danger" onClick={remove}>
              {t("characters.delete")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
