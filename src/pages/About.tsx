import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, HouseIcon } from "@phosphor-icons/react";
import { ABOUT, CREDITS } from "../about.config";
import { t } from "../i18n";
import { MOODS } from "../lib/mood";
import { openLink } from "../lib/platform";
import { TRACKS } from "../music.config";

/** Who made the app and where to find it (spec 10). Nothing here asks for money. */
export default function About() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(ABOUT.email);
      setCopyError(false);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{t("about.title")}</h1>
          <p className="muted">{t("about.subtitle")}</p>
        </div>
      </header>

      <section className="panel">
        <h2>{t("app.name")}</h2>
        <dl className="facts">
          <dt>{t("about.version")}</dt>
          <dd>{__APP_VERSION__}</dd>
          <dt>{t("about.madeBy")}</dt>
          <dd>{ABOUT.author}</dd>
          <dt>{t("about.contact")}</dt>
          <dd>
            <span className="row">
              <span className="selectable">{ABOUT.email}</span>
              <button className="btn small" onClick={copyEmail}>
                {copied ? <CheckIcon className="btn-icon" aria-hidden /> : <CopyIcon className="btn-icon" aria-hidden />}
                {copied ? t("about.copied") : t("about.copy")}
              </button>
            </span>
            {/* Read out by screen readers when Copy worked (QA-10). */}
            <span className="sr-only" role="status">
              {copied ? t("about.copyDone") : ""}
            </span>
            {copyError && <p className="result error">{t("about.copyError")}</p>}
          </dd>
        </dl>
      </section>

      {ABOUT.showHomePage && (
        <section className="panel">
          <h2>{t("about.homeTitle")}</h2>
          <button className="btn primary" onClick={() => void openLink(ABOUT.homePage)}>
            <HouseIcon className="btn-icon" aria-hidden />
            {t("about.home")}
          </button>
          <p className="hint">{t("about.homeText")}</p>
        </section>
      )}

      <section className="panel">
        <h2>{t("about.credits")}</h2>
        <p>{t("about.builtWith")}</p>
        <ul className="credits">
          {CREDITS.map((c) => (
            <li key={c.name}>
              {t("about.credit", { name: c.name, by: c.by, licence: c.licence })}
            </li>
          ))}
          <li>{t("about.artCredit")}</li>
        </ul>
        {/* CC BY asks for title, author, licence and a link to it, for every track (decision 134). */}
        <h3>{t("about.music")}</h3>
        <ul className="credits">
          {MOODS.map((mood) => {
            const track = TRACKS[mood];
            return (
              <li key={mood}>
                <span className="selectable">
                  {t("about.musicCredit", { title: track.title, artist: track.artist, licence: track.licence, url: track.licenceUrl })}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
