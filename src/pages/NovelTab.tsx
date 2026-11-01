import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BookBookmarkIcon,
  BookOpenTextIcon,
  CaretLeftIcon,
  CaretRightIcon,
  FlagCheckeredIcon,
  ListBulletsIcon,
  PenNibIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import Modal from "../components/Modal";
import Picture, { useImageLevel } from "../components/Picture";
import ProgressDialog from "../components/ProgressDialog";
import { MessageKey, t, tCount, tType } from "../i18n";
import { tRich } from "../i18n/rich";
import { AiError, AiStopped } from "../lib/ai";
import { ChapterInfo, defaultTitle, listChapters, readChapterSummary, readChapterText } from "../lib/chapters";
import type { StoryReadiness } from "../lib/characters";
import { AI_LOG_ENABLED, aiLogDir } from "../lib/devlog";
import { BlockVersion, chapterTexts, chooseVersion, chosenVersion, Draft, DraftBlock, saveDraft } from "../lib/draft";
import {
  acceptEpilogue,
  endChapter,
  EndChapterStep,
  endStory,
  loadNovelState,
  NovelState,
  reconcileStory,
  summarizeChapter,
  summaryInFlight,
} from "../lib/endChapter";
import type { Values } from "../lib/fields";
import { chapterProgress, ChapterProgress, finaleReached, plannedChapters } from "../lib/length";
import { music } from "../lib/music";
import { deathCanBeAccepted, nextBlockBlocked, writeBlock } from "../lib/novel";
import {
  blockPicturePath,
  chapterPicturePath,
  ChapterPictures,
  drawBlockPicture,
  drawChapterPicture,
  readChapterPictures,
} from "../lib/pictures";
import { loadSetting } from "../lib/setting";
import { getStory, Story, StoryEnding } from "../lib/stories";
import { getStoryType, hasSuggestions } from "../lib/storyTypes";
import { formatTokens, Tokens } from "../lib/tokens";
import { getUnsent, setUnsent } from "../lib/unsent";
import ChapterReview from "./ChapterReview";
import { errorText } from "../lib/errors";

interface Props {
  story: Story;
  ready: StoryReadiness;
  onGoTo: (tab: "setting" | "characters") => void;
  /** Called with story.json as it is now, after chapters end or the story completes. */
  onStoryChanged: (story: Story) => void;
  /** Called after the draft file changed, so the Setting tab can re-check its lock. */
  onDraftChanged: () => void;
  /** True while a block is being written, so leaving the story can ask first. */
  onWritingChange: (writing: boolean) => void;
  /** True while the End Chapter call runs, so leaving the story can ask first (decision 77). */
  onSummarizingChange: (summarizing: boolean) => void;
}

export default function NovelTab({
  story,
  ready,
  onGoTo,
  onStoryChanged,
  onDraftChanged,
  onWritingChange,
  onSummarizingChange,
}: Props) {
  if (!ready.hasSetting || !ready.hasMainCharacter) {
    return (
      <section className="panel">
        <h2>{t("novel.beforeTitle")}</h2>
        <p className="muted">{t("novel.beforeText")}</p>
        <ul className="checklist">
          <li className={ready.hasSetting ? "ok" : ""}>
            <span className="check" aria-hidden="true">{ready.hasSetting ? "✓" : ""}</span>
            <span>{t("novel.beforeSetting")}</span>
            <button className="btn small" onClick={() => onGoTo("setting")}>
              {t("novel.goSetting")}
            </button>
          </li>
          <li className={ready.hasMainCharacter ? "ok" : ""}>
            <span className="check" aria-hidden="true">{ready.hasMainCharacter ? "✓" : ""}</span>
            <span>{t("novel.beforeCharacter")}</span>
            <button className="btn small" onClick={() => onGoTo("characters")}>
              {t("novel.goCharacters")}
            </button>
          </li>
        </ul>
      </section>
    );
  }
  return (
    <Novel
      story={story}
      onStoryChanged={onStoryChanged}
      onDraftChanged={onDraftChanged}
      onWritingChange={onWritingChange}
      onSummarizingChange={onSummarizingChange}
    />
  );
}

function message(e: unknown) {
  return errorText(e);
}

/** A chapter's title; the titles the app wrote itself ("Chapter N", "Epilogue") in the UI language. */
function chapterTitle(c: { number: number; title: string }): string {
  if (c.title === defaultTitle(c.number)) return t("chapter.default", { n: c.number });
  if (c.title === "Epilogue") return t("chapter.epilogue");
  return c.title;
}

/** A chapter's name in the list and the reader links: "N. Title", or "Chapter N" alone. */
function chapterLabel(c: { number: number; title: string }): string {
  if (c.title === defaultTitle(c.number)) return chapterTitle(c);
  return t("chapter.numbered", { n: c.number, title: chapterTitle(c) });
}

/**
 * Story text as paragraphs; a blank line starts a new one. While streaming,
 * each new paragraph fades in as it arrives (spec 12.4). A finished chapter's
 * Rich pictures go after the paragraph that ends their block (spec 14.3).
 */
function Paragraphs({
  text,
  fade = false,
  pictures = [],
}: {
  text: string;
  fade?: boolean;
  pictures?: ChapterPictures["blocks"];
}) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <Fragment key={i}>
            <p className={fade ? "fade-in" : undefined}>{p.trim()}</p>
            {pictures
              .filter((pic) => pic.afterParagraph === i + 1)
              .map((pic) => (
                <Picture key={pic.path} path={pic.path} />
              ))}
          </Fragment>
        ))}
    </>
  );
}

const STEP_TEXT: Record<EndChapterStep, MessageKey> = {
  "saving-chapter": "steps.savingChapter",
  "writing-summary": "steps.writingSummary",
  "saving-summary": "steps.savingSummary",
};

/** A long step shown in the progress dialog (decision 88). */
interface Progress {
  title: string;
  step: string;
  stop?: () => void;
}

/** The Novel page once the story is ready: the chapter list and whatever step the story is at. */
function Novel({
  story,
  onStoryChanged,
  onDraftChanged,
  onWritingChange,
  onSummarizingChange,
}: {
  story: Story;
  onStoryChanged: (story: Story) => void;
  onDraftChanged: () => void;
  onWritingChange: (writing: boolean) => void;
  onSummarizingChange: (summarizing: boolean) => void;
}) {
  const [state, setState] = useState<NovelState | null>(null);
  const [setting, setSetting] = useState<Values | null>(null);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [reading, setReading] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The End Chapter call; leaving the story stops it, as it stops a block (decision 77). */
  const summary = useRef<AbortController | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  useEffect(() => () => summary.current?.abort(), []);
  useEffect(() => onSummarizingChange(summarizing), [summarizing, onSummarizingChange]);
  useEffect(() => () => onSummarizingChange(false), [onSummarizingChange]);

  const refresh = useCallback(async () => {
    try {
      // Repairs story.json if a write failed during End Chapter (decision 75).
      const fresh = await reconcileStory(await getStory(story.id));
      onStoryChanged(fresh);
      const next = await loadNovelState(fresh);
      setState(next);
      setChapters(await listChapters(fresh.id));
      onDraftChanged();
      // A call from before the user left and came back is still saving: wait for it rather than offer Retry.
      const running = summaryInFlight(fresh.id);
      if (next.kind === "summary-pending" && running) {
        setProgress({ title: t("steps.endChapter", { n: next.draft.chapter }), step: t("steps.writingSummary") });
        await running.catch(() => undefined);
        setProgress(null);
        await refresh();
      }
    } catch (e) {
      setLoadError(message(e));
    }
    // The callbacks come from the workspace and do not change what is loaded.
  }, [story.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The setting can change between chapters, so it is read again whenever the story is saved.
  useEffect(() => {
    loadSetting(story)
      .then((s) => setSetting(s.values))
      .catch((e) => setLoadError(message(e)));
  }, [story]);

  async function run(first: Progress, op: () => Promise<unknown>) {
    setProgress(first);
    setError(null);
    try {
      await op();
    } catch (e) {
      // Stop leaves the chapter saved and "summary pending"; that page says what to do next.
      if (!(e instanceof AiStopped)) setError(message(e));
    } finally {
      setProgress(null);
      await refresh();
    }
  }

  /** Runs the End Chapter call with a signal that Stop, or leaving the story, aborts. */
  async function runSummary(
    chapter: number,
    first: EndChapterStep,
    op: (signal: AbortSignal, onStep: (step: EndChapterStep) => void) => Promise<unknown>,
  ) {
    const controller = new AbortController();
    summary.current = controller;
    setSummarizing(true);
    const title = t("steps.endChapter", { n: chapter });
    const at = (step: EndChapterStep): Progress => ({
      title,
      step: t(STEP_TEXT[step]),
      // Only the AI call can be stopped; the file writes around it are quick.
      stop: step === "writing-summary" ? () => controller.abort() : undefined,
    });
    try {
      await run(at(first), () => op(controller.signal, (step) => setProgress(at(step))));
    } finally {
      summary.current = null;
      setSummarizing(false);
    }
  }

  if (loadError) return <div className="notice error">{loadError}</div>;
  if (!state || !setting) return <p className="muted">{t("common.loading")}</p>;

  return (
    <div className="novel-layout">
      <ChapterList chapters={chapters} state={state} reading={reading} onRead={setReading} />
      <div className="novel-main">
      {reading !== null && (
        <ChapterReader
          story={story}
          chapters={chapters}
          number={reading}
          hasCurrent={state.kind !== "completed"}
          onOpen={setReading}
          onBack={() => setReading(null)}
        />
      )}
      {/* Decision 91: the chapter in progress stays mounted while an earlier one is read,
          so its blocks (and a block still arriving) are there when the reader comes back. */}
      <div hidden={reading !== null}>

        {progress && (
          <ProgressDialog
            title={progress.title}
            step={progress.step}
            note={progress.stop ? t("steps.waitAi") : undefined}
            onStop={progress.stop}
          />
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

        {state.kind === "completed" && (
          <section className="panel">
            <h2>{t("novel.completedTitle")}</h2>
            <p className="muted">{t("novel.completedText")}</p>
          </section>
        )}

        {state.kind === "summary-pending" && (
          <section className="panel">
            <h2>{t("novel.pendingTitle", { n: state.draft.chapter })}</h2>
            <p className="muted">{t("novel.pendingText")}</p>
            <button
              className="btn primary"
              disabled={!!progress}
              onClick={() =>
                runSummary(state.draft.chapter, "writing-summary", (signal, onStep) =>
                  summarizeChapter(story, state.draft.chapter, signal, onStep),
                )
              }
            >
              {t("novel.retrySummary")}
            </button>
          </section>
        )}

        {state.kind === "review" && (
          <ChapterReview
            story={story}
            chapter={state.draft.chapter}
            summary={state.summary}
            review={state.review}
            setting={setting}
            onChanged={refresh}
          />
        )}

        {state.kind === "writing" && (
          <ChapterWriter
            key={`${state.draft.chapter}-${state.draft.epilogue ? "epilogue" : "chapter"}`}
            story={story}
            initialDraft={state.draft}
            setting={setting}
            disabled={!!progress}
            onDraftChanged={onDraftChanged}
            onWritingChange={onWritingChange}
            onEndChapter={(draft, ending) => {
              // Each chapter starts in silence (spec 13.2).
              music.endChapter();
              return runSummary(draft.chapter, "saving-chapter", (signal, onStep) =>
                endChapter(story, draft, ending, signal, onStep),
              );
            }}
            onEndStory={(draft) => {
              music.endChapter();
              return run({ title: t("steps.endStory"), step: t("steps.endingStory") }, () => endStory(story, draft));
            }}
            onAcceptEpilogue={(draft) =>
              run({ title: t("steps.epilogue"), step: t("steps.savingEpilogue") }, () => acceptEpilogue(story, draft))
            }
          />
        )}

        {AI_LOG_ENABLED && (
          <p className="hint">{tRich("novel.devlog", {}, { path: <code>{aiLogDir(story.id)}/</code> })}</p>
        )}
      </div>
      </div>
    </div>
  );
}

/**
 * The chapters down the left of the Novel page (spec 12.1, decisions 100, 108):
 * every ended chapter, then the one in progress, marked current. It scrolls on
 * its own and opens at the current chapter. Below 1100 pixels it folds into a
 * "Chapters" button that opens it over the page and closes after a pick.
 */
function ChapterList({
  chapters,
  state,
  reading,
  onRead,
}: {
  chapters: ChapterInfo[];
  state: NovelState;
  reading: number | null;
  onRead: (n: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLOListElement | null>(null);
  const side = useRef<HTMLElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);

  // The panel over the page closes with Escape, like the dialogs (QA-04).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const current =
    state.kind === "writing"
      ? state.draft.epilogue
        ? t("chapter.epilogue")
        : t("chapter.default", { n: state.draft.chapter })
      : state.kind === "review" || state.kind === "summary-pending"
        ? t("chapters.ending", { n: state.draft.chapter })
        : null;

  // The wide list ends at the bottom of the window, wherever the page is scrolled: it starts
  // below the story header and sticks under the top bar once that has scrolled away (QA-02).
  useLayoutEffect(() => {
    const nav = side.current;
    const page = nav?.closest(".main");
    if (!nav || !page) return;
    const fit = () => {
      // A hidden tab has no position to measure; it is measured again when shown (CR-06).
      if (nav.offsetParent === null) return;
      nav.style.maxHeight = open ? "" : `${Math.max(160, window.innerHeight - nav.getBoundingClientRect().top - 16)}px`;
    };
    fit();
    page.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    // The layout gets a size again when its tab is shown, so the list is fitted then too.
    const shown = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (nav.parentElement) shown?.observe(nav.parentElement);
    return () => {
      page.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      shown?.disconnect();
    };
  }, [open]);

  // Scrolls the list itself, not the page, so the current chapter is in view (decision 108).
  useLayoutEffect(() => {
    const el = list.current;
    const mark = el?.querySelector<HTMLElement>("[aria-current]");
    if (el && mark) el.scrollTop = mark.offsetTop - el.clientHeight / 2 + mark.offsetHeight / 2;
  }, [open, chapters.length, reading]);

  const pick = (n: number | null) => {
    onRead(n);
    setOpen(false);
  };

  return (
    <>
      <button ref={toggle} className="btn chapters-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ListBulletsIcon className="btn-icon" aria-hidden />
        {t("novel.chapters")}
      </button>
      {open && <div className="chapters-scrim" onClick={() => setOpen(false)} />}
      <nav ref={side} className={open ? "chapter-side open" : "chapter-side"} aria-label={t("novel.chapters")}>
        <div className="chapter-side-head">
          <h3>{t("novel.chapters")}</h3>
          <button
            className="icon-btn chapters-close"
            aria-label={t("chapters.close")}
            title={t("chapters.close")}
            onClick={() => setOpen(false)}
          >
            <XIcon aria-hidden />
          </button>
        </div>
        <ol ref={list}>
          {chapters.map((c) => (
            <li key={c.number}>
              <button
                className={reading === c.number ? "chapter-item active" : "chapter-item"}
                aria-current={reading === c.number ? "true" : undefined}
                aria-label={chapterLabel(c)}
                onClick={() => pick(c.number)}
              >
                <span className="chapter-num">{c.number}</span>
                <span className="chapter-name">{chapterTitle(c)}</span>
                {!c.hasSummary && <span className="tag">{t("novel.summaryPending")}</span>}
                {/* Reading has its own icon (spec 12.2, QA-07). */}
                <BookOpenTextIcon className="chapter-read" aria-hidden />
              </button>
            </li>
          ))}
          {current && (
            <li>
              <button
                className={reading === null ? "chapter-item current active" : "chapter-item current"}
                aria-current={reading === null ? "true" : undefined}
                onClick={() => pick(null)}
              >
                <PenNibIcon className="chapter-num" aria-hidden />
                <span className="chapter-name">{current}</span>
                <span className="tag">{t("chapters.current")}</span>
              </button>
            </li>
          )}
          {chapters.length === 0 && !current && <li className="muted">{t("chapters.none")}</li>}
        </ol>
      </nav>
    </>
  );
}

/** A finished chapter, read-only (spec 5.6), with links to the chapters on either side. */
function ChapterReader({
  story,
  chapters,
  number,
  hasCurrent,
  onOpen,
  onBack,
}: {
  story: Story;
  chapters: ChapterInfo[];
  number: number;
  /** False once the story is completed: there is no current chapter to go back to. */
  hasCurrent: boolean;
  onOpen: (n: number) => void;
  onBack: () => void;
}) {
  const storyId = story.id;
  const [chapter, setChapter] = useState<{
    title: string;
    text: string;
    tokens?: Tokens;
    scene?: string;
    pictures: ChapterPictures;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const images = useImageLevel();
  const top = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setChapter(null);
    setError(null);
    (async () => {
      try {
        const summary = await readChapterSummary(storyId, number).catch(() => null);
        setChapter({
          title: chapterTitle({ number, title: summary?.title ?? defaultTitle(number) }),
          text: await readChapterText(storyId, number),
          tokens: summary?.tokens,
          scene: summary?.picture,
          // A chapter whose pictures cannot be read is still readable (spec 14.4).
          pictures: await readChapterPictures(storyId, number).catch(() => ({ chapter: null, blocks: [] })),
        });
        top.current?.scrollIntoView({ block: "start" });
      } catch (e) {
        setError(message(e));
      }
    })();
  }, [storyId, number]);

  const index = chapters.findIndex((c) => c.number === number);
  const previous = index > 0 ? chapters[index - 1] : undefined;
  const next = index >= 0 ? chapters[index + 1] : undefined;
  const links = (
    <nav className="reader-nav" aria-label={t("reader.nav")}>
      {previous ? (
        <button className="link" onClick={() => onOpen(previous.number)}>
          <ArrowLeftIcon className="btn-icon" aria-hidden />
          {t("reader.previous", { title: chapterLabel(previous) })}
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button className="link" onClick={() => onOpen(next.number)}>
          {t("reader.next", { title: chapterLabel(next) })}
          <ArrowRightIcon className="btn-icon after" aria-hidden />
        </button>
      ) : (
        hasCurrent && (
          <button className="link" onClick={onBack}>
            {t("reader.toCurrent")}
            <ArrowRightIcon className="btn-icon after" aria-hidden />
          </button>
        )
      )}
    </nav>
  );

  return (
    <section className="chapter" ref={top}>
      <button className="back" onClick={onBack}>
        <ArrowLeftIcon className="btn-icon" aria-hidden />
        {t("reader.back")}
      </button>
      {error && <div className="notice error">{t("reader.error", { error })}</div>}
      {!chapter && !error && <p className="muted">{t("common.loading")}</p>}
      {chapter && (
        <>
          {links}
          <header className="chapter-head">
            <h2>{chapter.title}</h2>
            <span className="muted">{t("reader.meta", { n: number })}</span>
          </header>
          {chapter.tokens && <p className="hint">{t("tokens.used", { amount: formatTokens(chapter.tokens) })}</p>}
          {/* Lite: the chapter's picture at its top (spec 14.3). A chapter with a summary scene can still get one. */}
          <Picture
            path={chapterPicturePath(storyId, number)}
            scene={chapter.scene}
            onDraw={images === "lite" && chapter.scene ? () => void drawChapterPicture(story, number) : undefined}
          />
          <article className="reading chapter-text paper" aria-label={t("reader.text")}>
            <div className="block">
              <Paragraphs text={chapter.text} pictures={chapter.pictures.blocks} />
            </div>
          </article>
          {links}
        </>
      )}
    </section>
  );
}

/** Chapter length against its target (spec 5.3). The bar runs to the hard limit; the mark is the target. */
function ProgressBar({ progress }: { progress: ChapterProgress }) {
  const { count, limits, stage } = progress;
  const note = stage === "soft" ? t("bar.target") : stage === "hard" ? t("bar.limit") : "";
  return (
    <div className={`progress ${stage}`}>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={t("bar.label")}
        aria-valuemin={0}
        aria-valuemax={limits.target}
        aria-valuenow={count}
      >
        <div className="progress-fill" style={{ width: `${Math.min(100, (count / limits.hard) * 100)}%` }} />
        <div className="progress-target" style={{ left: `${(limits.target / limits.hard) * 100}%` }} />
      </div>
      <span className="muted">
        {t("bar.count", { count, target: limits.target, unit: t(`unit.${limits.unit}`) })}
        {note}
      </span>
    </div>
  );
}

type Run = { direction: string } | { regenerate: { hint: string } };
type Confirm = "end-chapter" | "death" | "end-story" | "epilogue" | null;

function ChapterWriter(props: {
  story: Story;
  initialDraft: Draft;
  setting: Values;
  disabled: boolean;
  onDraftChanged: () => void;
  /** True while a block is arriving, so leaving the story can ask first. */
  onWritingChange: (writing: boolean) => void;
  onEndChapter: (draft: Draft, ending?: StoryEnding) => void;
  onEndStory: (draft: Draft) => void;
  onAcceptEpilogue: (draft: Draft) => void;
}) {
  const { story, setting } = props;
  const [draft, setDraft] = useState<Draft>(props.initialDraft);
  /** The block arriving now; null when nothing is being written. */
  const [streaming, setStreaming] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Unsent text outlives this page, so leaving the story does not lose it (decision 59).
  const [direction, setDirectionState] = useState(() => getUnsent(story.id).direction);
  const [hint, setHintState] = useState(() => getUnsent(story.id).hint);
  const setDirection = (value: string) => {
    setDirectionState(value);
    setUnsent(story.id, { direction: value });
  };
  const setHint = (value: string) => {
    setHintState(value);
    setUnsent(story.id, { hint: value });
  };
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [openings, setOpenings] = useState<string[]>([]);
  // Decision 126: without suggestions, every block needs the user's direction.
  const suggests = hasSuggestions(getStoryType(story.type));
  const images = useImageLevel();
  const abort = useRef<AbortController | null>(null);
  const streamEl = useRef<HTMLDivElement | null>(null);

  // Leaving the story stops a block in progress; the draft is unchanged (decision 38).
  useEffect(() => () => abort.current?.abort(), []);

  // Decision 65: the previous chapter's End Chapter call suggested how this one could open.
  const { chapter } = props.initialDraft;
  useEffect(() => {
    if (chapter < 2 || props.initialDraft.epilogue || !suggests) return;
    readChapterSummary(story.id, chapter - 1)
      .then((s) => setOpenings(s?.openings ?? []))
      .catch(() => setOpenings([])); // Without openings the direction box still works.
  }, [story.id, chapter, props.initialDraft.epilogue, suggests]);

  const busy = streaming !== null;
  const { onWritingChange } = props;
  useEffect(() => {
    if (busy) streamEl.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    onWritingChange(busy);
  }, [busy, onWritingChange]);
  useEffect(() => () => onWritingChange(false), [onWritingChange]);

  async function run(what: Run) {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setNotice(null);
    setRegenerating("regenerate" in what);
    setStreaming("");
    try {
      const next = await writeBlock({ story, draft, ...what, signal: controller.signal, onText: setStreaming });
      setDraft(next);
      setDirection("");
      setHint("");
      props.onDraftChanged();
      // A peak block brings in its music; a regenerated one uses its new version's mood (spec 13.2).
      const latest = next.blocks.at(-1);
      music.blockFinished(latest && chosenVersion(latest).mood);
      // Rich: the new version's picture is drawn in the background; writing never waits for it (spec 14.3).
      const version = latest && chosenVersion(latest);
      if (version?.picture) void drawBlockPicture(story, next.chapter, version);
    } catch (e) {
      if (e instanceof AiStopped) setNotice(t("writer.stopped"));
      else if (e instanceof AiError) setError(e.message);
      else setError(t("writer.blockFailed", { error: message(e) }));
    } finally {
      abort.current = null;
      setStreaming(null);
      setRegenerating(false);
    }
  }

  async function switchVersion(index: number) {
    const next = chooseVersion(draft, index);
    try {
      await saveDraft(story.id, next);
      setDraft(next);
    } catch (e) {
      setError(t("writer.versionFailed", { error: message(e) }));
    }
  }

  const blocks = draft.blocks;
  const latest = blocks.at(-1);
  const epilogue = !!draft.epilogue;
  const progress = chapterProgress(chapterTexts(draft), String(setting.chapter_length ?? ""), String(setting.language ?? ""));
  const died = !!latest && chosenVersion(latest).died;
  // Decision 49: after the block written at the hard limit, End Chapter is the only step left.
  const closed = !epilogue && !died && nextBlockBlocked(draft, setting) !== null;
  const idle = !busy && !props.disabled;
  // While the latest block is regenerated, its new version streams in its place.
  const shown = busy && regenerating ? blocks.slice(0, -1) : blocks;
  const firstOfStory = draft.chapter === 1 && blocks.length === 0;
  const storyLength = String(setting.story_length ?? "");
  const finale = finaleReached(storyLength, story.chapterCount);

  return (
    <section className="chapter">
      <header className="chapter-head">
        <h2>{epilogue ? t("chapter.epilogue") : t("chapter.default", { n: draft.chapter })}</h2>
        {!epilogue && <span className="muted">{tCount("writer.blocks", blocks.length)}</span>}
      </header>
      {blocks.length === 0 && !busy && epilogue && (
        <div className="panel">
          <h2>{t("epilogue.title")}</h2>
          <p className="muted">
            {story.ending === "death" ? t("epilogue.textDeath") : t("epilogue.text")} {t("epilogue.regenerate")}
          </p>
          <DirectionForm
            typeId={story.type}
            label={t("epilogue.direction")}
            value={direction}
            onChange={setDirection}
            optional
            disabled={!idle}
            button={t("epilogue.write")}
            onSubmit={() => run({ direction })}
          />
        </div>
      )}

      {blocks.length === 0 && !busy && !epilogue && (
        <div className="panel">
          <h2>{t("start.title", { n: draft.chapter })}</h2>
          <p className="muted">
            {!suggests
              ? t("start.own")
              : firstOfStory
                ? t("start.first")
                : openings.length > 0
                  ? t("start.withOpenings")
                  : t("start.later")}
          </p>
          {openings.length > 0 && (
            <div className="suggestions" role="group" aria-label={t("start.openings")}>
              {openings.map((o) => (
                <button key={o} className="btn suggestion" disabled={!idle} onClick={() => run({ direction: o })}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <DirectionForm
            typeId={story.type}
            label={t("start.direction")}
            value={direction}
            onChange={setDirection}
            optional={suggests}
            disabled={!idle}
            button={t("start.title", { n: draft.chapter })}
            onSubmit={() => run({ direction })}
          />
        </div>
      )}

      {blocks.length === 0 && !busy && !epilogue && story.chapterCount > 0 && (
        <div className="panel end-story">
          <p className="muted">
            {finale ? t("endStory.finale", { count: plannedChapters(storyLength) ?? 0 }) : t("endStory.ready")}
          </p>
          {/* Decision 64: a warning look of its own; solid once the planned chapters are written. */}
          <button
            className={finale ? "btn end-story solid" : "btn end-story"}
            disabled={!idle}
            onClick={() => setConfirm("end-story")}
          >
            <FlagCheckeredIcon className="btn-icon" weight="fill" aria-hidden />
            {t("endStory.button")}
          </button>
        </div>
      )}

      {(shown.length > 0 || busy) && (
        <article className="reading chapter-text paper" aria-label={t("reader.text")}>
          {shown.map((b, i) => {
            const version = chosenVersion(b);
            return (
              <div key={i} className="block">
                <Paragraphs text={version.text} />
                {/* Spec 14.3: Rich draws a picture per version; saved pictures still show when images are off. */}
                <Picture
                  path={blockPicturePath(story.id, version)}
                  scene={version.picture}
                  onDraw={images === "rich" ? () => void drawBlockPicture(story, draft.chapter, version) : undefined}
                />
                <BlockTokens version={version} />
              </div>
            );
          })}
          {busy && (
            <div className="block streaming" ref={streamEl} aria-live="polite" aria-busy="true">
              <Paragraphs text={streaming} fade />
              <span className="cursor" aria-hidden="true" />
            </div>
          )}
        </article>
      )}

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}

      {latest && idle && (
        <LatestBlockTools
          block={latest}
          label={epilogue ? t("tools.regenerateEpilogue") : t("tools.regenerateBlock")}
          hint={hint}
          onHint={setHint}
          onChoose={switchVersion}
          onRegenerate={() => run({ regenerate: { hint } })}
        />
      )}

      {latest && idle && epilogue && (
        <div className="panel next">
          <h3>{t("acceptEpilogue.title")}</h3>
          <p className="muted">{t("acceptEpilogue.text")}</p>
          <button className="btn primary" onClick={() => setConfirm("epilogue")}>
            {t("acceptEpilogue.button")}
          </button>
        </div>
      )}

      {latest && idle && died && (
        <div className="panel next death">
          <h3>{t("death.title")}</h3>
          {/* Decision 62: under Never, the AI's death cannot end the story. */}
          <p className="muted">{deathCanBeAccepted(setting) ? t("death.text") : t("death.never")}</p>
          <div className="row">
            <button className="btn" onClick={() => run({ regenerate: { hint } })}>
              <ArrowClockwiseIcon className="btn-icon" aria-hidden />
              {t("death.regenerate")}
            </button>
            {deathCanBeAccepted(setting) && (
              <button className="btn danger" onClick={() => setConfirm("death")}>
                {t("death.accept")}
              </button>
            )}
          </div>
        </div>
      )}

      {latest && idle && closed && (
        <div className="panel next">
          <h3>{t("closed.title")}</h3>
          <p className="muted">{t("closed.text")}</p>
        </div>
      )}

      {latest && idle && !epilogue && !died && !closed && (
        <div className="panel next">
          <h3>{t("next.title")}</h3>
          {!suggests ? null : chosenVersion(latest).actions.length > 0 ? (
            <div className="suggestions" role="group" aria-label={t("next.suggestions")}>
              {chosenVersion(latest).actions.map((a, i) => {
                const note = chosenVersion(latest).notes?.[i];
                return (
                  <button key={a} className="btn suggestion" onClick={() => run({ direction: a })}>
                    <span className="suggestion-action">{a}</span>
                    {/* Decision 86: what it might do; only the action is sent. */}
                    {note && <span className="suggestion-note">{note}</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted">{t("next.none")}</p>
          )}
          <DirectionForm
            typeId={story.type}
            label={t("next.direction")}
            value={direction}
            onChange={setDirection}
            optional={false}
            disabled={false}
            button={t("next.write")}
            onSubmit={() => run({ direction })}
          />
        </div>
      )}

      {/* Decisions 64, 88: progress, the block being written and End Chapter stay in view while the chapter scrolls. */}
      {(!epilogue || busy) && (
        <div className="action-bar" role="region" aria-label={t("bar.region")}>
          {!epilogue && <ProgressBar progress={progress} />}
          {!epilogue && draft.tokens && (
            <span className="muted bar-tokens">{t("tokens.chapterSoFar", { amount: formatTokens(draft.tokens) })}</span>
          )}
          {busy && (
            <div className="row writing">
              <span className="row writing-status" role="status">
                <span className="spinner" aria-hidden="true" />
                {regenerating ? t("writer.rewriting") : t("writer.writing")}
              </span>
              <button className="btn" onClick={() => abort.current?.abort()}>
                <StopIcon className="btn-icon" weight="fill" aria-hidden />
                {t("common.stop")}
              </button>
            </div>
          )}
          {!epilogue && latest && !died && (
            <button
              className={progress.stage === "open" ? "btn end-chapter" : "btn end-chapter ready"}
              disabled={!idle}
              onClick={() => setConfirm("end-chapter")}
            >
              <BookBookmarkIcon className="btn-icon" weight="fill" aria-hidden />
              {t("endChapter.button")}
            </button>
          )}
        </div>
      )}

      {confirm === "end-chapter" && (
        <ConfirmModal
          title={t("confirmEnd.title", { n: draft.chapter })}
          text={t("confirmEnd.text")}
          cancel={t("confirmEnd.cancel")}
          ok={t("endChapter.button")}
          onCancel={() => setConfirm(null)}
          onOk={() => {
            setConfirm(null);
            props.onEndChapter(draft);
          }}
        />
      )}
      {confirm === "death" && (
        <ConfirmModal
          title={t("confirmDeath.title")}
          text={t("confirmDeath.text", { n: draft.chapter })}
          cancel={t("common.goBack")}
          ok={t("death.accept")}
          danger
          onCancel={() => setConfirm(null)}
          onOk={() => {
            setConfirm(null);
            props.onEndChapter(draft, "death");
          }}
        />
      )}
      {confirm === "end-story" && (
        <ConfirmModal
          title={t("confirmEndStory.title")}
          text={t("confirmEndStory.text")}
          cancel={t("common.goBack")}
          ok={t("endStory.button")}
          onCancel={() => setConfirm(null)}
          onOk={() => {
            setConfirm(null);
            props.onEndStory(draft);
          }}
        />
      )}
      {confirm === "epilogue" && (
        <ConfirmModal
          title={t("acceptEpilogue.title")}
          text={t("confirmEpilogue.text")}
          cancel={t("common.goBack")}
          ok={t("acceptEpilogue.button")}
          onCancel={() => setConfirm(null)}
          onOk={() => {
            setConfirm(null);
            props.onAcceptEpilogue(draft);
          }}
        />
      )}
    </section>
  );
}

/** The tokens one block used (spec 6.6); blocks from before phase 6 have none. */
function BlockTokens({ version }: { version: BlockVersion }) {
  if (!version.tokens) return null;
  return (
    <p className="block-tokens" title={t("tokens.block")}>
      {formatTokens(version.tokens)}
    </p>
  );
}

function ConfirmModal(props: {
  title: string;
  text: string;
  cancel: string;
  ok: string;
  danger?: boolean;
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <Modal title={props.title} onClose={props.onCancel}>
      <p>{props.text}</p>
      <div className="actions">
        <button className="btn" onClick={props.onCancel}>
          {props.cancel}
        </button>
        <button className={props.danger ? "btn danger" : "btn primary"} onClick={props.onOk}>
          {props.ok}
        </button>
      </div>
    </Modal>
  );
}

function DirectionForm(props: {
  /** The story type, for a placeholder that fits the genre (QA-09). */
  typeId: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional: boolean;
  disabled: boolean;
  button: string;
  onSubmit: () => void;
}) {
  const canSubmit = !props.disabled && (props.optional || props.value.trim() !== "");
  return (
    <form
      className="direction"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) props.onSubmit();
      }}
    >
      <label htmlFor="direction">
        {props.label}
        {props.optional && <span className="muted">{t("form.optional")}</span>}
      </label>
      <textarea
        id="direction"
        rows={3}
        value={props.value}
        placeholder={tType("direction.placeholder", props.typeId)}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl+Enter sends, Enter alone makes a new line.
          if (e.key === "Enter" && e.ctrlKey && canSubmit) {
            e.preventDefault();
            props.onSubmit();
          }
        }}
      />
      <div className="row end">
        <button type="submit" className="btn primary" disabled={!canSubmit}>
          <PenNibIcon className="btn-icon" aria-hidden />
          {props.button}
        </button>
      </div>
    </form>
  );
}

/** Regenerate with a hint, and switch between versions of the latest block (spec 5.2). */
function LatestBlockTools(props: {
  block: DraftBlock;
  label: string;
  hint: string;
  onHint: (v: string) => void;
  onChoose: (index: number) => void;
  onRegenerate: () => void;
}) {
  const { block } = props;
  const count = block.versions.length;
  return (
    <div className="block-tools">
      <div className="row">
        {count > 1 && (
          <div className="versions" role="group" aria-label={t("tools.versions")}>
            <button
              className="icon-btn"
              aria-label={t("tools.previousVersion")}
              disabled={block.chosen === 0}
              onClick={() => props.onChoose(block.chosen - 1)}
            >
              <CaretLeftIcon aria-hidden />
            </button>
            <span>{t("tools.version", { n: block.chosen + 1, count })}</span>
            <button
              className="icon-btn"
              aria-label={t("tools.nextVersion")}
              disabled={block.chosen === count - 1}
              onClick={() => props.onChoose(block.chosen + 1)}
            >
              <CaretRightIcon aria-hidden />
            </button>
          </div>
        )}
        <input
          className="hint-input"
          aria-label={t("tools.hint")}
          value={props.hint}
          placeholder={t("tools.hintPlaceholder")}
          onChange={(e) => props.onHint(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onRegenerate();
          }}
        />
        <button className="btn" onClick={props.onRegenerate}>
          <ArrowClockwiseIcon className="btn-icon" aria-hidden />
          {props.label}
        </button>
      </div>
    </div>
  );
}
