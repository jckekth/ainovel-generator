import { useEffect, useRef, useState } from "react";
import { CheckIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { fieldLabel, t } from "../i18n";
import { tRich } from "../i18n/rich";
import { ChapterSummary, renameChapter } from "../lib/chapters";
import {
  approveProposal,
  finishChapter,
  formatValue,
  markAccepted,
  NewCharacterProposal,
  newCharacterFrom,
  Proposal,
  rejectProposal,
  Review,
  reviewDone,
} from "../lib/endChapter";
import { Character, listCharacters } from "../lib/characters";
import { defaultValue, Values } from "../lib/fields";
import { Story } from "../lib/stories";
import { characterFields, getStoryType } from "../lib/storyTypes";
import { formatTokens } from "../lib/tokens";
import { CharacterForm } from "./CharactersTab";
import Picture, { useImageLevel } from "../components/Picture";
import { chapterPicturePath, drawChapterPicture } from "../lib/pictures";
import { errorText } from "../lib/errors";

interface Props {
  story: Story;
  chapter: number;
  summary: ChapterSummary;
  review: Review;
  setting: Values;
  /** Reloads the Novel page after every answer, so the review shown is the one on disk. */
  onChanged: () => Promise<void>;
}

function message(e: unknown) {
  return errorText(e);
}


/** End Chapter steps 3 and 4 (spec 5.4): edit the title, answer each proposal, then finish. */
export default function ChapterReview({ story, chapter, summary, review, setting, onChanged }: Props) {
  const [title, setTitle] = useState(summary.title);
  const [editing, setEditing] = useState<NewCharacterProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const images = useImageLevel();
  /** The story's characters, whose names Random name skips in "Edit first" (spec 7.1, CR6-03). */
  const [others, setOthers] = useState<Character[]>([]);
  useEffect(() => {
    if (!editing) return;
    listCharacters(story)
      .then((list) => setOthers(list.characters))
      .catch(() => setOthers([]));
  }, [editing, story]);

  // The title is saved as it is typed, like every other answer here, so leaving or
  // closing the app before Finish keeps it (spec 5.4, decision 60). Saves run in
  // order, so an older title never lands after a newer one.
  const titleSaves = useRef<Promise<void>>(Promise.resolve());
  const savedTitle = useRef(summary.title);
  function saveTitle(value: string) {
    const next = value.trim();
    if (!next || next === savedTitle.current) return titleSaves.current;
    savedTitle.current = next;
    titleSaves.current = titleSaves.current
      .then(() => renameChapter(story.id, chapter, next))
      .catch((e) => setError(t("review.titleError", { error: message(e) })));
    return titleSaves.current;
  }
  useEffect(() => {
    const timer = setTimeout(() => void saveTitle(title), 400);
    return () => clearTimeout(timer);
  }, [title]);

  async function act(op: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await op();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      await onChanged();
    }
  }

  if (editing) {
    return (
      <CharacterForm
        others={others}
        story={story}
        initial={newCharacterFrom(editing)}
        setting={setting}
        backLabel={t("review.back")}
        onDone={(changed) => {
          const proposal = editing;
          setEditing(null);
          // A new character the user saved from the form counts as accepted.
          if (changed) void act(() => markAccepted(story.id, chapter, proposal.id));
        }}
      />
    );
  }

  const done = reviewDone(review);

  return (
    <section className="chapter review">
      <header className="chapter-head">
        <h2>{t("review.title", { n: chapter })}</h2>
      </header>

      <section className="panel">
        <div className="field">
          <label htmlFor="chapter-title">{t("review.chapterTitle")}</label>
          <input
            id="chapter-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle(title)}
          />
        </div>
        {/* Lite: the chapter's picture arrives while the user reviews (spec 14.3). */}
        <Picture
          path={chapterPicturePath(story.id, chapter)}
          scene={summary.picture}
          onDraw={images === "lite" ? () => void drawChapterPicture(story, chapter) : undefined}
        />
        <h3>{t("review.summary")}</h3>
        <p className="reading summary">{summary.summary}</p>
        {summary.tokens && <p className="hint">{t("tokens.used", { amount: formatTokens(summary.tokens) })}</p>}
      </section>

      <section className="panel">
        <h3>{t("review.proposals")}</h3>
        {review.proposals.length === 0 ? (
          <p className="muted">{t("review.none")}</p>
        ) : (
          <>
            <p className="muted">{t("review.howTo")}</p>
            <ul className="proposals">
              {review.proposals.map((p) => (
                <ProposalItem
                  key={p.id}
                  story={story}
                  proposal={p}
                  disabled={busy}
                  onApprove={() => act(() => approveProposal(story, chapter, p.id))}
                  onReject={() => act(() => rejectProposal(story.id, chapter, p.id))}
                  onEdit={p.kind === "new" ? () => setEditing(p) : undefined}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      <div className="savebar">
        {!done && <p className="result muted">{t("review.answerAll")}</p>}
        <button
          className="btn primary"
          disabled={busy || !done}
          onClick={() =>
            act(async () => {
              await saveTitle(title);
              await finishChapter(story, chapter);
            })
          }
        >
          {t("review.finish")}
        </button>
      </div>
    </section>
  );
}

/** Decision 67: say when the age is the app's, not the AI's, so the user can change it with Edit. */
function ageFilledText(why: "missing" | "too-low", age: unknown): string {
  return t(why === "missing" ? "review.ageMissing" : "review.ageLow", { age: String(age), button: t("review.editFirst") });
}

function ProposalItem(props: {
  story: Story;
  proposal: Proposal;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit?: () => void;
}) {
  const { proposal: p } = props;
  const answered = p.status !== "pending";
  const field = p.kind === "change" ? characterFields(getStoryType(props.story.type)).find((f) => f.key === p.field) : undefined;
  return (
    <li className={`proposal ${p.status}`}>
      <div className="proposal-text">
        {p.kind === "change" ? (
          <p>
            <strong>{p.characterName}</strong> · {field ? fieldLabel(field) : p.label}:{" "}
            <span className="old">{formatValue(p.oldValue, field)}</span> → <span className="new">{formatValue(p.newValue, field)}</span>
          </p>
        ) : (
          <>
            <p>{tRich("review.newCharacter", {}, { name: <strong>{p.name}</strong> })}</p>
            <p className="muted">{newCharacterFacts(props.story, p.values)}</p>
            {p.ageFilled && <p className="hint age-filled">{ageFilledText(p.ageFilled, p.values.age)}</p>}
          </>
        )}
        {p.reason && <p className="muted reason">{p.reason}</p>}
      </div>
      <div className="proposal-actions">
        {answered ? (
          <span className={`tag ${p.status === "approved" ? "done" : ""}`}>
            {p.status === "approved" ? t("review.approved") : t("review.rejected")}
          </span>
        ) : (
          <>
            <button className="btn small" disabled={props.disabled} onClick={props.onReject}>
              <XIcon className="btn-icon" aria-hidden />
              {t("review.reject")}
            </button>
            {props.onEdit && (
              <button className="btn small" disabled={props.disabled} onClick={props.onEdit}>
                <PencilSimpleIcon className="btn-icon" aria-hidden />
                {t("review.editFirst")}
              </button>
            )}
            <button className="btn small primary" disabled={props.disabled} onClick={props.onApprove}>
              <CheckIcon className="btn-icon" aria-hidden />
              {p.kind === "new" ? t("review.accept") : t("review.approve")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** The fields the AI filled in for a new character, leaving out the name and untouched defaults. */
function newCharacterFacts(story: Story, values: Values): string {
  const facts = characterFields(getStoryType(story.type))
    .filter((f) => f.key !== "name")
    .filter((f) => JSON.stringify(values[f.key]) !== JSON.stringify(defaultValue(f)) && formatValue(values[f.key]) !== t("common.empty"))
    .map((f) => `${fieldLabel(f)}: ${formatValue(values[f.key], f)}`);
  return facts.join(" · ") || t("review.noDetails");
}
