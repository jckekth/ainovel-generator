import { useEffect, useState } from "react";
import { CompassIcon, FolderOpenIcon, KeyIcon, PlugsIcon } from "@phosphor-icons/react";
import SetupGuide from "../components/SetupGuide";
import { LOCALE_NAMES, LOCALES, MessageKey, t, tCount } from "../i18n";
import { AiError, listModels } from "../lib/ai";
import { errorText } from "../lib/errors";
import { isTauri, openFolder } from "../lib/platform";
import { costText, loadImageConfig } from "../lib/pictures";
import { deleteApiKey, deleteImageKey, getApiKey, getImageKey, setApiKey, setImageKey } from "../lib/secrets";
import {
  AppSettings,
  ContextBudget,
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  ImageLevel,
} from "../lib/settings";
import { store } from "../lib/storage";

interface Props {
  settings: AppSettings;
  firstRun: boolean;
  hasKey: boolean;
  onChange: (next: AppSettings) => Promise<void>;
  onKeyChange: (hasKey: boolean) => void;
}

const BUDGETS: { id: ContextBudget; name: MessageKey; desc: MessageKey }[] = [
  { id: "lean", name: "budget.lean", desc: "budget.leanDesc" },
  { id: "balanced", name: "budget.balanced", desc: "budget.balancedDesc" },
  { id: "rich", name: "budget.rich", desc: "budget.richDesc" },
];

type Result = { kind: "ok" | "error"; text: string } | null;

export default function Settings({ settings, firstRun, hasKey, onChange, onKeyChange }: Props) {
  const [keyInput, setKeyInput] = useState("");
  const [keyResult, setKeyResult] = useState<Result>(null);
  const [testResult, setTestResult] = useState<Result>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  // Text fields keep a local copy so typing is not interrupted by saving.
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  // Opens by itself only on first launch; the Setup guide button opens it later (decision 82).
  const [guideOpen, setGuideOpen] = useState(firstRun);

  useEffect(() => {
    void store.rootPath().then(setDataPath);
  }, []);

  function patch(change: Partial<AppSettings>) {
    void onChange({ ...settings, ...change });
  }

  async function saveKey() {
    const key = keyInput.trim();
    if (!key) return;
    try {
      await setApiKey(key);
      setKeyInput("");
      onKeyChange(true);
      setKeyResult({ kind: "ok", text: t("settings.keySaved") });
    } catch (e) {
      setKeyResult({ kind: "error", text: t("settings.keySaveError", { error: message(e) }) });
    }
  }

  async function removeKey() {
    try {
      await deleteApiKey();
      onKeyChange(false);
      setKeyResult({ kind: "ok", text: t("settings.keyRemoved") });
    } catch (e) {
      setKeyResult({ kind: "error", text: t("settings.keyRemoveError", { error: message(e) }) });
    }
  }

  /** Tests with the key being typed if there is one, otherwise with the saved key. */
  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const apiKey = keyInput.trim() || (await getApiKey()) || "";
      const found = await listModels({ baseUrl, apiKey });
      setModels(found);
      setTestResult({ kind: "ok", text: tCount("settings.connected", found.length) });
    } catch (e) {
      setTestResult({
        kind: "error",
        text: e instanceof AiError ? e.message : t("settings.testFailed", { error: message(e) }),
      });
    } finally {
      setTesting(false);
    }
  }

  async function showFolder() {
    if (!dataPath) return;
    try {
      setFolderError(null);
      await openFolder(dataPath);
    } catch (e) {
      setFolderError(t("settings.folderError", { error: message(e) }));
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
          <p className="muted">{t("settings.subtitle")}</p>
        </div>
      </header>

      {firstRun && (
        <div className="notice guide">
          <strong>{t("settings.welcomeTitle")}</strong>
          <ol>
            <li>{t("settings.welcome1")}</li>
            <li>{t("settings.welcome2")}</li>
            <li>{t("settings.welcome3")}</li>
          </ol>
          <span>{t("settings.welcomePay")}</span>
        </div>
      )}

      {guideOpen && (
        <SetupGuide
          baseUrl={baseUrl}
          onUseBaseUrl={(url) => {
            setBaseUrl(url);
            patch({ baseUrl: url });
          }}
          onClose={() => setGuideOpen(false)}
        />
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>{t("settings.ai")}</h2>
          <button className="btn" onClick={() => setGuideOpen(true)}>
            <CompassIcon className="btn-icon" aria-hidden />
            {t("settings.setupGuide")}
          </button>
        </div>

        <div className="field">
          <label htmlFor="api-key">{t("settings.apiKey")}</label>
          <div className="row">
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              value={keyInput}
              placeholder={hasKey ? t("settings.keyPlaceholderSaved") : t("settings.keyPlaceholder")}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button className="btn primary" onClick={saveKey} disabled={!keyInput.trim()}>
              <KeyIcon className="btn-icon" aria-hidden />
              {t("settings.saveKey")}
            </button>
            {hasKey && (
              <button className="btn" onClick={removeKey}>
                {t("settings.removeKey")}
              </button>
            )}
          </div>
          <p className="hint">
            {isTauri() ? t("settings.keyStoreApp") : t("settings.keyStoreBrowser")}
          </p>
          {keyResult && <p className={`result ${keyResult.kind}`}>{keyResult.text}</p>}
        </div>

        <div className="field">
          <label htmlFor="base-url">{t("settings.baseUrl")}</label>
          <div className="row">
            <input
              id="base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={() => patch({ baseUrl: baseUrl.trim() })}
            />
            <button
              className="btn"
              onClick={() => {
                setBaseUrl(DEFAULT_SETTINGS.baseUrl);
                patch({ baseUrl: DEFAULT_SETTINGS.baseUrl });
              }}
              disabled={baseUrl === DEFAULT_SETTINGS.baseUrl}
            >
              {t("settings.reset")}
            </button>
          </div>
          <p className="hint">{t("settings.baseUrlHint")}</p>
        </div>

        <div className="field">
          <div className="row">
            <button className="btn" onClick={test} disabled={testing}>
              <PlugsIcon className="btn-icon" aria-hidden />
              {testing ? t("settings.testing") : t("settings.test")}
            </button>
            {testResult && <p className={`result ${testResult.kind}`}>{testResult.text}</p>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="model">{t("settings.model")}</label>
          <input
            id="model"
            list="model-list"
            value={model}
            placeholder={t("settings.modelPlaceholder")}
            onChange={(e) => {
              setModel(e.target.value);
              // Picking from the list fires change without a blur, so save right away.
              if (models.includes(e.target.value)) patch({ model: e.target.value });
            }}
            onBlur={() => patch({ model: model.trim() })}
          />
          <datalist id="model-list">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        <fieldset className="field">
          <legend>{t("settings.budget")}</legend>
          <div className="choices three">
            {BUDGETS.map((b) => (
              <label
                key={b.id}
                className={settings.contextBudget === b.id ? "choice selected" : "choice"}
              >
                <input
                  type="radio"
                  name="budget"
                  checked={settings.contextBudget === b.id}
                  onChange={() => patch({ contextBudget: b.id })}
                />
                <span className="choice-name">{t(b.name)}</span>
                <span className="choice-desc">{t(b.desc)}</span>
              </label>
            ))}
          </div>
          <p className="hint">{t("settings.budgetHint")}</p>
        </fieldset>
      </section>

      <section className="panel">
        <h2>{t("settings.appearance")}</h2>

        <div className="field">
          <label htmlFor="ui-language">{t("settings.language")}</label>
          {/* Spec 11: each language in its own script, so anyone can find theirs. */}
          <select
            id="ui-language"
            className="short"
            value={settings.uiLanguage}
            onChange={(e) => patch({ uiLanguage: e.target.value as AppSettings["uiLanguage"] })}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
          <p className="hint">{t("settings.languageHint")}</p>
        </div>

        <div className="field">
          <label htmlFor="font-size">{t("settings.fontSize", { size: settings.fontSize })}</label>
          <input
            id="font-size"
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            value={settings.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })}
          />
          <p className="reading preview">
            {t("settings.preview")}
          </p>
        </div>

        <fieldset className="field">
          <legend>{t("settings.theme")}</legend>
          <div className="segmented">
            {(["light", "dark"] as const).map((theme) => (
              <label key={theme} className={settings.theme === theme ? "seg selected" : "seg"}>
                <input
                  type="radio"
                  name="theme"
                  checked={settings.theme === theme}
                  onChange={() => patch({ theme })}
                />
                {theme === "light" ? t("settings.light") : t("settings.dark")}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>{t("settings.art")}</legend>
          <div className="segmented">
            {([true, false] as const).map((on) => (
              <label key={String(on)} className={settings.backgroundArt === on ? "seg selected" : "seg"}>
                <input
                  type="radio"
                  name="background-art"
                  checked={settings.backgroundArt === on}
                  onChange={() => patch({ backgroundArt: on })}
                />
                {on ? t("settings.artOn") : t("settings.artOff")}
              </label>
            ))}
          </div>
          <p className="hint">{t("settings.artHint")}</p>
        </fieldset>
      </section>

      <section className="panel">
        <h2>{t("settings.sound")}</h2>

        <fieldset className="field">
          <legend>{t("settings.music")}</legend>
          <div className="segmented">
            {([true, false] as const).map((on) => (
              <label key={String(on)} className={settings.music === on ? "seg selected" : "seg"}>
                <input type="radio" name="music" checked={settings.music === on} onChange={() => patch({ music: on })} />
                {on ? t("settings.artOn") : t("settings.artOff")}
              </label>
            ))}
          </div>
          <p className="hint">{t("settings.musicHint")}</p>
        </fieldset>

        <div className="field">
          <label htmlFor="music-volume">{t("settings.musicVolume", { volume: settings.musicVolume })}</label>
          <input
            id="music-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.musicVolume}
            disabled={!settings.music}
            onChange={(e) => patch({ musicVolume: Number(e.target.value) })}
          />
        </div>
      </section>

      <ImageSettings settings={settings} patch={patch} />

      <section className="panel">
        <h2>{t("settings.data")}</h2>
        {dataPath ? (
          <>
            <p className="muted">{t("settings.dataText")}</p>
            <p className="path">{dataPath}</p>
            <button className="btn" onClick={showFolder}>
              <FolderOpenIcon className="btn-icon" aria-hidden />
              {t("settings.openFolder")}
            </button>
            {folderError && <p className="result error">{folderError}</p>}
          </>
        ) : (
          <p className="muted">{t("settings.dataBrowser")}</p>
        )}
      </section>
    </div>
  );
}

function message(e: unknown): string {
  return errorText(e);
}

const IMAGE_LEVELS: { id: ImageLevel; name: MessageKey; desc: MessageKey }[] = [
  { id: "none", name: "settings.imageNone", desc: "settings.imageNoneDesc" },
  { id: "lite", name: "settings.imageLite", desc: "settings.imageLiteDesc" },
  { id: "rich", name: "settings.imageRich", desc: "settings.imageRichDesc" },
];

/** The Pictures group (spec 14.1): the level, its cost, and the image provider. */
function ImageSettings({ settings, patch }: { settings: AppSettings; patch: (change: Partial<AppSettings>) => void }) {
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyResult, setKeyResult] = useState<Result>(null);
  const [testResult, setTestResult] = useState<Result>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [baseUrl, setBaseUrl] = useState(settings.imageBaseUrl);
  const [model, setModel] = useState(settings.imageModel);
  const same = settings.imageSameAsText;

  useEffect(() => {
    void getImageKey()
      .then((k) => setHasKey(!!k))
      .catch(() => setHasKey(false));
  }, []);

  async function saveKey() {
    const key = keyInput.trim();
    if (!key) return;
    try {
      await setImageKey(key);
      setKeyInput("");
      setHasKey(true);
      setKeyResult({ kind: "ok", text: t("settings.keySaved") });
    } catch (e) {
      setKeyResult({ kind: "error", text: t("settings.keySaveError", { error: message(e) }) });
    }
  }

  async function removeKey() {
    try {
      await deleteImageKey();
      setHasKey(false);
      setKeyResult({ kind: "ok", text: t("settings.keyRemoved") });
    } catch (e) {
      setKeyResult({ kind: "error", text: t("settings.keyRemoveError", { error: message(e) }) });
    }
  }

  /** Lists the models and checks the image model is one of them; it never makes a picture, so it costs nothing. */
  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const { config } = same
        ? await loadImageConfig(settings)
        : { config: { baseUrl, apiKey: keyInput.trim() || (await getImageKey()) || "" } };
      const found = await listModels(config);
      setModels(found);
      const name = model.trim();
      setTestResult(
        found.includes(name)
          ? { kind: "ok", text: t("settings.imageModelFound", { model: name }) }
          : { kind: "error", text: t("settings.imageModelMissing", { model: name || "?", count: found.length }) },
      );
    } catch (e) {
      setTestResult({
        kind: "error",
        text: e instanceof AiError ? e.message : t("settings.testFailed", { error: message(e) }),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="images-title">
      <h2 id="images-title">{t("settings.images")}</h2>

      <fieldset className="field">
        <legend>{t("settings.imageLevel")}</legend>
        <div className="choices three">
          {IMAGE_LEVELS.map((l) => (
            <label key={l.id} className={settings.images === l.id ? "choice selected" : "choice"}>
              <input type="radio" name="images" checked={settings.images === l.id} onChange={() => patch({ images: l.id })} />
              <span className="choice-name">{t(l.name)}</span>
              <span className="choice-desc">{t(l.desc)}</span>
            </label>
          ))}
        </div>
        {/* Decision 142: the cost is shown before Lite or Rich is chosen. */}
        <p className="hint image-cost">{costText(settings.imageModel, settings.imageQuality)}</p>
        <p className="hint">{t("settings.imageHint")}</p>
      </fieldset>

      <fieldset className="field">
        <legend>{t("settings.imageQuality")}</legend>
        <div className="segmented">
          {(["low", "medium"] as const).map((q) => (
            <label key={q} className={settings.imageQuality === q ? "seg selected" : "seg"}>
              <input type="radio" name="image-quality" checked={settings.imageQuality === q} onChange={() => patch({ imageQuality: q })} />
              {q === "low" ? t("settings.qualityLow") : t("settings.qualityMedium")}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t("settings.imageProvider")}</legend>
        <div className="segmented">
          {([true, false] as const).map((on) => (
            <label key={String(on)} className={same === on ? "seg selected" : "seg"}>
              <input type="radio" name="image-same" checked={same === on} onChange={() => patch({ imageSameAsText: on })} />
              {on ? t("settings.imageSameOn") : t("settings.imageSameOff")}
            </label>
          ))}
        </div>
        <p className="hint">{t("settings.imageSameHint")}</p>
      </fieldset>

      {!same && (
        <>
          <div className="field">
            <label htmlFor="image-key">{t("settings.imageKey")}</label>
            <div className="row">
              <input
                id="image-key"
                type="password"
                autoComplete="off"
                value={keyInput}
                placeholder={hasKey ? t("settings.keyPlaceholderSaved") : t("settings.keyPlaceholder")}
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <button className="btn primary" onClick={saveKey} disabled={!keyInput.trim()}>
                <KeyIcon className="btn-icon" aria-hidden />
                {t("settings.saveImageKey")}
              </button>
              {hasKey && (
                <button className="btn" onClick={removeKey} aria-label={`${t("settings.removeKey")}: ${t("settings.imageKey")}`}>
                  {t("settings.removeKey")}
                </button>
              )}
            </div>
            <p className="hint">{isTauri() ? t("settings.keyStoreApp") : t("settings.keyStoreBrowser")}</p>
            {keyResult && <p className={`result ${keyResult.kind}`}>{keyResult.text}</p>}
          </div>

          <div className="field">
            <label htmlFor="image-base-url">{t("settings.imageBaseUrl")}</label>
            <div className="row">
              <input
                id="image-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => patch({ imageBaseUrl: baseUrl.trim() })}
              />
              <button
                className="btn"
                aria-label={`${t("settings.reset")}: ${t("settings.imageBaseUrl")}`}
                onClick={() => {
                  setBaseUrl(DEFAULT_SETTINGS.imageBaseUrl);
                  patch({ imageBaseUrl: DEFAULT_SETTINGS.imageBaseUrl });
                }}
                disabled={baseUrl === DEFAULT_SETTINGS.imageBaseUrl}
              >
                {t("settings.reset")}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="image-model">{t("settings.imageModel")}</label>
        <input
          id="image-model"
          list="image-model-list"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            if (models.includes(e.target.value)) patch({ imageModel: e.target.value });
          }}
          onBlur={() => patch({ imageModel: model.trim() })}
        />
        <datalist id="image-model-list">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="hint">{t("settings.imageModelHint")}</p>
      </div>

      <div className="field">
        <div className="row">
          <button className="btn" onClick={test} disabled={testing}>
            <PlugsIcon className="btn-icon" aria-hidden />
            {testing ? t("settings.testing") : t("settings.testImage")}
          </button>
          {testResult && <p className={`result ${testResult.kind}`}>{testResult.text}</p>}
        </div>
      </div>
    </section>
  );
}
