import { useRef } from "react";
import { t } from "../i18n";
import { useDialogFocus } from "./useDialogFocus";

interface Props {
  title: string;
  /** What is happening now, e.g. "Saving the chapter…". */
  step: string;
  /** A line under the step, e.g. what stopping means. */
  note?: string;
  /** Shown as a Stop button while the step can be stopped. */
  onStop?: () => void;
}

/**
 * A long step that runs behind a dialog with a spinner and its current step
 * (decision 88). It cannot be closed; it goes away when the step ends.
 */
export default function ProgressDialog({ title, step, note, onStop }: Props) {
  const dialog = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialog);
  return (
    <div className="overlay">
      <div ref={dialog} tabIndex={-1} className="modal progress-dialog" role="dialog" aria-modal="true" aria-label={title} aria-busy="true">
        <h2>{title}</h2>
        <div className="row progress-step" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{step}</span>
        </div>
        {note && <p className="hint">{note}</p>}
        {onStop && (
          <div className="actions">
            <button className="btn" onClick={onStop}>
              {t("common.stop")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
