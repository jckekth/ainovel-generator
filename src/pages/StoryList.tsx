import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { DotsThreeVerticalIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import TypeEmblem from "../components/TypeEmblem";
import Modal from "../components/Modal";
import { getLocale, t, tCount, typeDescription, typeName } from "../i18n";
import { tRich } from "../i18n/rich";
import { createStory, deleteStory, listStories, Story } from "../lib/stories";
import { LANGUAGES, NOVEL_LANGUAGES, STORY_TYPES, storyTypeName } from "../lib/storyTypes";
import { errorText } from "../lib/errors";

interface Props {
  hasKey: boolean;
  onOpen: (id: string) => void;
  onOpenSettings: () => void;
}

export default function StoryList({ hasKey, onOpen, onOpenSettings }: Props) {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Story | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStories(await listStories());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("stories.title")}</h1>
          <p className="muted">{t("stories.subtitle")}</p>
        </div>
        {/* No New story button here: the shelf's last book is one, and an empty shelf shows its own. */}
      </header>

      {!hasKey && (
        <div className="notice">
          <span>{t("stories.noKey")}</span>
          <button className="btn small" onClick={onOpenSettings}>
            {t("stories.openSettings")}
          </button>
        </div>
      )}

      {error && <div className="notice error">{t("stories.loadError", { error })}</div>}

      {!stories && !error && <p className="muted">{t("common.loading")}</p>}

      {stories && stories.length === 0 && !error && (
        <div className="empty">
          <h2>{t("stories.emptyTitle")}</h2>
          <p>{t("stories.emptyText")}</p>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <PlusIcon className="btn-icon" aria-hidden />
            {t("stories.new")}
          </button>
        </div>
      )}

      {/* Decisions 96, 109: books on a shelf, the most recently opened first, wrapping onto more rows. */}
      {stories && stories.length > 0 && (
        <ul className="shelf" aria-label={t("stories.shelf")}>
          {stories.map((s) => (
            <Book key={s.id} story={s} onOpen={() => onOpen(s.id)} onDelete={() => setToDelete(s)} />
          ))}
          <li className="book-slot">
            <button className="book new-book" onClick={() => setCreating(true)}>
              <PlusIcon className="new-book-icon" aria-hidden />
              <span className={isChineseTitle(t("stories.new")) ? "spine-title vertical" : "spine-title"}>{t("stories.new")}</span>
            </button>
          </li>
        </ul>
      )}

      {creating && (
        <NewStoryModal
          onClose={() => setCreating(false)}
          onCreated={(story) => {
            setCreating(false);
            onOpen(story.id);
          }}
        />
      )}

      {toDelete && (
        <DeleteModal
          story={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={() => {
            setToDelete(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** Chinese titles run top to bottom on the spine, as on a printed Chinese book (decision 109). */
export function isChineseTitle(title: string): boolean {
  return /[\u3400-\u9fff]/.test(title);
}

/** Characters that fit a spine written top to bottom. */
const SPINE_CHARS = 8;

/**
 * A vertical title too long for the spine ends with a vertical "︙"; CSS can
 * only cut with a horizontal "…" (QA-12). Other titles are cut by CSS.
 */
export function spineTitle(title: string): string {
  if (!isChineseTitle(title)) return title;
  const chars = [...title];
  return chars.length > SPINE_CHARS ? chars.slice(0, SPINE_CHARS - 1).join("") + "︙" : title;
}

/**
 * One story as a book (spec 12.2). The spine shows the title and the type's
 * emblem in the type's shade of gray; a completed story has a ribbon. Hover
 * and focus show the type, language and chapter count; Delete is in the
 * book's menu.
 */
function Book({ story, onOpen, onDelete }: { story: Story; onOpen: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    // Escape gives focus back to the menu button, so a keyboard user keeps their place (QA-05).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      menuButton.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const details = [storyTypeName(story.type), story.language, tCount("common.chapters", story.chapterCount)];
  if (story.status === "completed") details.push(t("common.completed"));
  return (
    <li className="book-slot">
      <button
        className={`book type-${story.type}${story.status === "completed" ? " completed" : ""}`}
        onClick={onOpen}
        aria-label={t("stories.openAria", { title: story.title, details: details.join(", ") })}
      >
        <span className={isChineseTitle(story.title) ? "spine-title vertical" : "spine-title"}>{spineTitle(story.title)}</span>
        <TypeEmblem typeId={story.type} className="spine-emblem" />
        {story.status === "completed" && <span className="ribbon" aria-hidden="true" />}
      </button>
      <div className="book-card" role="tooltip">
        <strong>{story.title}</strong>
        <span>{details.join(" · ")}</span>
      </div>
      <div className="book-menu" ref={menuRef}>
        <button
          ref={menuButton}
          className="icon-btn book-menu-btn"
          aria-label={t("stories.menuAria", { title: story.title })}
          title={t("stories.menu")}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <DotsThreeVerticalIcon weight="bold" aria-hidden />
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button
              role="menuitem"
              className="menu-item danger"
              autoFocus
              onClick={() => {
                // The dialog gives focus back to the menu button, not to this item that closes with the menu.
                menuButton.current?.focus();
                setMenu(false);
                onDelete();
              }}
            >
              <TrashIcon className="btn-icon" aria-hidden />
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function NewStoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (story: Story) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState(STORY_TYPES[0].id);
  // Starts as the UI language; the user can still pick another (decision 71).
  const [language, setLanguage] = useState(NOVEL_LANGUAGES[getLocale()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = title.trim() !== "" && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    try {
      onCreated(await createStory({ title, type, language }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("newStory.title")} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{t("newStory.titleLabel")}</span>
          <input
            autoFocus
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("newStory.titlePlaceholder")}
          />
        </label>

        <fieldset className="field">
          <legend>{t("newStory.type")}</legend>
          <div className="choices">
            {STORY_TYPES.map((st) => (
              <label key={st.id} className={type === st.id ? "choice selected" : "choice"}>
                <input
                  type="radio"
                  name="story-type"
                  value={st.id}
                  checked={type === st.id}
                  onChange={() => setType(st.id)}
                />
                <span className="choice-name">
                  <TypeEmblem typeId={st.id} className="choice-emblem" />
                  {typeName(st)}
                </span>
                <span className="choice-desc">{typeDescription(st)}</span>
              </label>
            ))}
          </div>
          <p className="hint">{t("newStory.typeHint")}</p>
        </fieldset>

        <label className="field">
          <span>{t("newStory.language")}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <span className="hint">{t("newStory.languageHint")}</span>
        </label>

        {error && <div className="notice error">{t("newStory.error", { error })}</div>}

        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!canCreate}>
            {t("newStory.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteModal({
  story,
  onClose,
  onDeleted,
}: {
  story: Story;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await deleteStory(story.id);
      onDeleted();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("deleteStory.title")} onClose={onClose}>
      <p>{tRich("deleteStory.text", { count: story.chapterCount }, { title: <strong>{story.title}</strong> })}</p>
      {error && <div className="notice error">{t("deleteStory.error", { error })}</div>}
      <div className="actions">
        <button className="btn" onClick={onClose}>
          {t("deleteStory.keep")}
        </button>
        <button className="btn danger" onClick={confirm} disabled={busy}>
          <TrashIcon className="btn-icon" aria-hidden />
          {t("deleteStory.delete")}
        </button>
      </div>
    </Modal>
  );
}
