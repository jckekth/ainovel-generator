import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowClockwiseIcon, ImageIcon } from "@phosphor-icons/react";
import { t } from "../i18n";
import { errorText } from "../lib/errors";
import { pictureState, pictureUrl, picturesChanged, subscribePictures } from "../lib/pictures";
import { ImageLevel, loadSettings } from "../lib/settings";

/** The Pictures level from Settings (spec 14.1); "none" until it is read. Settings is its own page, so reading it once is enough. */
export function useImageLevel(): ImageLevel {
  const [level, setLevel] = useState<ImageLevel>("none");
  useEffect(() => {
    let live = true;
    loadSettings()
      .then((s) => live && setLevel(s.images))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return level;
}

/**
 * One picture of the story (spec 14.3): the picture once it is saved,
 * "Drawing…" while it is made, or why it failed with Try again (spec 14.4).
 * With `onDraw` and no picture yet, it offers "Make picture"; without it, an
 * empty place shows nothing. `data-picture` names the state for the E2E tests.
 */
export default function Picture({ path, scene, onDraw }: { path: string; scene?: string; onDraw?: () => void }) {
  const state = useSyncExternalStore(subscribePictures, () => pictureState(path));
  const changed = useSyncExternalStore(subscribePictures, picturesChanged);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Looks again whenever a picture is saved, so a new one shows without reloading the page.
  useEffect(() => {
    let live = true;
    pictureUrl(path)
      .then((u) => live && (setUrl(u), setError(null)))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [path, changed]);

  if (state?.kind === "drawing") {
    return (
      <div className="picture drawing" data-picture="drawing" role="status" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        {t("picture.drawing")}
      </div>
    );
  }
  if (url) {
    return (
      <figure className="picture" data-picture="shown">
        <img src={url} alt={scene ? t("picture.alt", { scene }) : t("picture.altPlain")} />
      </figure>
    );
  }
  if (state?.kind === "failed" || error) {
    return (
      <div className="picture failed" data-picture="failed" role="status">
        <p>{state?.kind === "failed" ? t("picture.failed", { error: state.error }) : t("picture.cannotShow", { error: error ?? "" })}</p>
        {onDraw && (
          <button className="btn small" onClick={onDraw}>
            <ArrowClockwiseIcon className="btn-icon" aria-hidden />
            {t("picture.retry")}
          </button>
        )}
      </div>
    );
  }
  if (!onDraw) return null;
  return (
    <div className="picture make" data-picture="make">
      <button className="btn small" onClick={onDraw}>
        <ImageIcon className="btn-icon" aria-hidden />
        {t("picture.make")}
      </button>
    </div>
  );
}
