import { useCallback, useEffect, useRef, useState } from "react";
import { BooksIcon, GearSixIcon, InfoIcon } from "@phosphor-icons/react";
import { setLocale, t } from "./i18n";
import { music } from "./lib/music";
import { onWindowHidden } from "./lib/platform";
import { getApiKey } from "./lib/secrets";
import { AppSettings, applyAppearance, loadSettings, saveSettings } from "./lib/settings";
import { listStories } from "./lib/stories";
import StoryList from "./pages/StoryList";
import StoryWorkspace from "./pages/StoryWorkspace";
import Settings from "./pages/Settings";
import About from "./pages/About";
import BookOpening from "./components/BookOpening";

type View =
  | { name: "stories" }
  | { name: "story"; id: string }
  | { name: "settings"; firstRun?: boolean }
  | { name: "about" };

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [view, setView] = useState<View>({ name: "stories" });
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Set by an open story that has unsaved edits; asks before the page changes. */
  const leaveGuard = useRef<((leave: () => void) => void) | null>(null);
  const registerLeaveGuard = useCallback((guard: ((leave: () => void) => void) | null) => {
    leaveGuard.current = guard;
  }, []);
  const navigate = (next: View) => (leaveGuard.current ? leaveGuard.current(() => setView(next)) : setView(next));

  useEffect(() => {
    (async () => {
      try {
        const loaded = await loadSettings();
        setLocale(loaded.uiLanguage);
        applyAppearance(loaded);
        setSettings(loaded);
        // A key store that cannot be reached (Linux with no keyring) must not
        // stop the app opening; Settings explains it when a key is saved (decision 93).
        const key = await getApiKey().catch(() => null);
        setHasKey(!!key);
        // A brand-new install starts on the settings page, because nothing can
        // be generated without an API key.
        if (!key && (await listStories()).length === 0) {
          setView({ name: "settings", firstRun: true });
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  // Music settings apply at once, also to a track playing or paused (spec 13.3).
  const musicOn = settings?.music ?? false;
  const musicVolume = settings?.musicVolume ?? 0;
  useEffect(() => music.configure(musicOn, musicVolume / 100), [musicOn, musicVolume]);
  // Minimising or hiding the window pauses the music too (decision 132).
  useEffect(() => onWindowHidden((hidden) => music.setHidden(hidden)), []);

  const updateSettings = useCallback(async (next: AppSettings) => {
    // Set before the re-render, so every page renders in the new language (spec 11).
    setLocale(next.uiLanguage);
    setSettings(next);
    applyAppearance(next);
    await saveSettings(next);
  }, []);

  if (loadError) {
    return (
      <div className="boot">
        <h1>{t("app.bootTitle")}</h1>
        <p>{t("app.bootText")}</p>
        <pre>{loadError}</pre>
      </div>
    );
  }
  if (!settings) return <div className="boot">{t("common.loading")}</div>;

  /** The page the navigation marks as current; a story belongs to Stories. */
  const section = view.name === "story" ? "stories" : view.name;
  const navLink = (name: "stories" | "settings" | "about", icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button
      className={section === name ? "nav-link active" : "nav-link"}
      aria-current={section === name ? "page" : undefined}
      onClick={() => navigate({ name })}
    >
      {icon}
      {label}
      {extra}
    </button>
  );

  return (
    <div className="shell">
      {/* Decision 100: a top bar in place of the left rail; the version is on About. */}
      <nav className="topbar" aria-label={t("nav.main")}>
        <span className="brand">{t("app.name")}</span>
        <div className="nav-links">
          {navLink("stories", <BooksIcon className="nav-icon" aria-hidden />, t("nav.stories"))}
          {navLink(
            "settings",
            <GearSixIcon className="nav-icon" aria-hidden />,
            t("nav.settings"),
            !hasKey && <span className="dot" title={t("nav.noKey")} />,
          )}
          {navLink("about", <InfoIcon className="nav-icon" aria-hidden />, t("nav.about"))}
        </div>
      </nav>

      <main className="main" key={view.name === "story" ? `story-${view.id}` : view.name}>
        {view.name === "stories" && (
          <StoryList
            hasKey={hasKey}
            onOpen={(id) => setView({ name: "story", id })}
            onOpenSettings={() => setView({ name: "settings" })}
          />
        )}
        {/* Decision 102: the book opens over the page while the story loads behind it. */}
        {view.name === "story" && <BookOpening key={`open-${view.id}`} storyId={view.id} />}
        {view.name === "story" && (
          <StoryWorkspace
            key={view.id}
            storyId={view.id}
            artOn={settings.backgroundArt}
            onBack={() => setView({ name: "stories" })}
            registerLeaveGuard={registerLeaveGuard}
          />
        )}
        {view.name === "settings" && (
          <Settings
            settings={settings}
            firstRun={!!view.firstRun}
            hasKey={hasKey}
            onChange={updateSettings}
            onKeyChange={setHasKey}
          />
        )}
        {view.name === "about" && <About />}
      </main>
    </div>
  );
}
