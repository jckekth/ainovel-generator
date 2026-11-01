import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, FeatherIcon, MapTrifoldIcon, UsersThreeIcon } from "@phosphor-icons/react";
import Modal from "../components/Modal";
import StoryArt from "../components/StoryArt";
import { MessageKey, t, tCount } from "../i18n";
import { getReadiness, StoryReadiness } from "../lib/characters";
import { music } from "../lib/music";
import { getStory, markOpened, Story } from "../lib/stories";
import { storyTypeName } from "../lib/storyTypes";
import CharactersTab from "./CharactersTab";
import NovelTab from "./NovelTab";
import SettingTab from "./SettingTab";

interface Props {
  storyId: string;
  /** Settings → Appearance → Background art (spec 12.3). */
  artOn: boolean;
  onBack: () => void;
  /**
   * Gives the app a function that asks before leaving the story, or null when
   * nothing is unsaved. The app calls it before switching pages.
   */
  registerLeaveGuard: (guard: ((leave: () => void) => void) | null) => void;
}

type Tab = "novel" | "characters" | "setting";

const TABS: { id: Tab; label: MessageKey; icon: React.ReactNode }[] = [
  { id: "novel", label: "tabs.novel", icon: <FeatherIcon className="tab-icon" aria-hidden /> },
  { id: "characters", label: "tabs.characters", icon: <UsersThreeIcon className="tab-icon" aria-hidden /> },
  { id: "setting", label: "tabs.setting", icon: <MapTrifoldIcon className="tab-icon" aria-hidden /> },
];

export default function StoryWorkspace({ storyId, artOn, onBack, registerLeaveGuard }: Props) {
  const [story, setStory] = useState<Story | null>(null);
  const [ready, setReady] = useState<StoryReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("novel");
  const [settingVersion, setSettingVersion] = useState(0);
  const [draftVersion, setDraftVersion] = useState(0);
  const [settingDirty, setSettingDirty] = useState(false);
  /** A block is being written; leaving stops and discards it (decisions 38, 59). */
  const [writing, setWriting] = useState(false);
  /** The End Chapter call is running; leaving stops it and the chapter waits for Retry (decision 77). */
  const [summarizing, setSummarizing] = useState(false);
  /** Where the user wanted to go when they were asked about unsaved Setting edits or a block in progress. */
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  const guarded = settingDirty || writing || summarizing;
  /** The AI call leaving would stop, if any; it is asked about before unsaved Setting edits. */
  const running = writing ? "block" : summarizing ? "summary" : null;
  const askToLeave = useCallback((leave: () => void) => setPendingLeave(() => leave), []);
  useEffect(() => {
    registerLeaveGuard(guarded ? askToLeave : null);
    return () => registerLeaveGuard(null);
  }, [guarded, askToLeave, registerLeaveGuard]);
  const back = () => (guarded ? askToLeave(onBack) : onBack());
  // The block finished while the question was open: nothing is at risk any more.
  useEffect(() => {
    if (!guarded) setPendingLeave(null);
  }, [guarded]);

  // Music belongs to the open story: leaving it in any way pauses the music, and coming back resumes it (decision 132).
  useEffect(() => {
    music.enterStory(storyId);
    return () => music.leaveStory();
  }, [storyId]);

  const refreshReadiness = useCallback(async () => {
    setReady(await getReadiness(storyId));
  }, [storyId]);

  useEffect(() => {
    (async () => {
      try {
        // Opening counts for the bookshelf order (decision 109). Only for the order: a
        // story.json that cannot be written (locked, disk full) still opens (CR-04).
        setStory(await markOpened(storyId).catch(() => getStory(storyId)));
        await refreshReadiness();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [storyId, refreshReadiness]);

  if (error) {
    return (
      <div className="page">
        <button className="back" onClick={onBack}>
          <ArrowLeftIcon className="btn-icon" aria-hidden />
          {t("workspace.back")}
        </button>
        <div className="notice error">{t("workspace.openError", { error })}</div>
      </div>
    );
  }
  if (!story || !ready) return <div className="page muted">{t("common.loading")}</div>;

  return (
    <div className="page workspace">
      {artOn && <StoryArt typeId={story.type} />}
      <button className="back" onClick={back}>
        <ArrowLeftIcon className="btn-icon" aria-hidden />
        {t("workspace.back")}
      </button>
      <header className="page-head">
        <div>
          <h1>{story.title}</h1>
          <p className="story-meta">
            <span className="tag">{storyTypeName(story.type)}</span>
            <span>{story.language}</span>
            <span>{tCount("common.chapters", story.chapterCount)}</span>
            {story.status === "completed" && <span className="tag done">{t("common.completed")}</span>}
          </p>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {TABS.map((tab_) => (
          <button
            key={tab_.id}
            role="tab"
            aria-selected={tab === tab_.id}
            className={tab === tab_.id ? "tab active" : "tab"}
            onClick={() => setTab(tab_.id)}
          >
            {tab_.icon}
            {t(tab_.label)}
          </button>
        ))}
      </div>

      {/* All tabs stay mounted, so unsaved edits survive switching tabs. */}
      <div role="tabpanel" className="tabpanel" hidden={tab !== "novel"}>
        <NovelTab
          story={story}
          ready={ready}
          onGoTo={setTab}
          onStoryChanged={setStory}
          onDraftChanged={() => setDraftVersion((v) => v + 1)}
          onWritingChange={setWriting}
          onSummarizingChange={setSummarizing}
        />
      </div>
      <div role="tabpanel" className="tabpanel" hidden={tab !== "characters"}>
        <CharactersTab story={story} artOn={artOn} settingVersion={settingVersion} onChanged={refreshReadiness} />
      </div>
      <div role="tabpanel" className="tabpanel" hidden={tab !== "setting"}>
        <SettingTab
          story={story}
          draftVersion={draftVersion}
          writing={writing}
          onDirtyChange={setSettingDirty}
          onSaved={(updated) => {
            setStory(updated);
            setSettingVersion((v) => v + 1);
            void refreshReadiness();
          }}
        />
      </div>

      {pendingLeave && (
        <Modal
          title={
            running === "block"
              ? t("leave.blockTitle")
              : running === "summary"
                ? t("leave.summaryTitle")
                : t("leave.settingTitle")
          }
          onClose={() => setPendingLeave(null)}
        >
          {running === "block" && (
            <p>{t("leave.blockText")}</p>
          )}
          {running === "summary" && (
            <p>{t("leave.summaryText", { button: t("novel.retrySummary") })}</p>
          )}
          {settingDirty && <p>{t("leave.settingText")}</p>}
          <div className="actions">
            <button
              className="btn"
              onClick={() => {
                setPendingLeave(null);
                setTab(running ? "novel" : "setting");
              }}
            >
              {running ? t("leave.stay") : t("common.keepEditing")}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                const leave = pendingLeave;
                setPendingLeave(null);
                leave();
              }}
            >
              {running === "block"
                ? t("leave.discardBlock")
                : running === "summary"
                  ? t("leave.stopSummary")
                  : t("common.discardChanges")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
