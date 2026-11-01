import { useState } from "react";
import { errorText } from "../lib/errors";
import { openLink } from "../lib/platform";
import Modal from "./Modal";
import { MessageKey, t } from "../i18n";

interface Provider {
  name: string;
  note: MessageKey;
  baseUrl: string;
  keyPage: string;
}

/** A few well-known OpenAI-compatible providers (decision 81). Any other one works the same way. */
export const PROVIDERS: Provider[] = [
  {
    name: "OpenAI",
    note: "guide.openai",
    baseUrl: "https://api.openai.com/v1",
    keyPage: "https://platform.openai.com/api-keys",
  },
  {
    name: "DeepSeek",
    note: "guide.deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    keyPage: "https://platform.deepseek.com/api_keys",
  },
  {
    name: "OpenRouter",
    note: "guide.openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPage: "https://openrouter.ai/keys",
  },
];

interface Props {
  baseUrl: string;
  onUseBaseUrl: (url: string) => void;
  onClose: () => void;
}

export default function SetupGuide({ baseUrl, onUseBaseUrl, onClose }: Props) {
  const [linkError, setLinkError] = useState<string | null>(null);

  async function open(url: string) {
    try {
      setLinkError(null);
      await openLink(url);
    } catch (e) {
      setLinkError(t("guide.linkError", { error: errorText(e), url }));
    }
  }

  return (
    <Modal title={t("guide.title")} onClose={onClose}>
      <p className="muted">{t("guide.intro")}</p>

      <ol className="setup-steps">
        <li>
          <strong>{t("guide.step1Title")}</strong> {t("guide.step1Text")}
          <ul className="providers">
            {PROVIDERS.map((p) => (
              <li key={p.name} className="provider">
                <div>
                  <span className="provider-name">{p.name}</span>
                  <span className="hint">{t(p.note)}</span>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => void open(p.keyPage)}>
                    {t("guide.getKey")}
                  </button>
                  <button
                    className="btn"
                    onClick={() => onUseBaseUrl(p.baseUrl)}
                    disabled={baseUrl === p.baseUrl}
                  >
                    {baseUrl === p.baseUrl ? t("guide.baseUrlSet") : t("guide.useBaseUrl")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {linkError && <p className="result error">{linkError}</p>}
        </li>
        <li>
          <strong>{t("guide.step2Title")}</strong> {t("guide.step2Text")}
        </li>
        <li>
          <strong>{t("guide.step3Title")}</strong> {t("guide.step3Text")}
        </li>
        <li>
          <strong>{t("guide.step4Title")}</strong> {t("guide.step4Text")}
        </li>
        <li>
          <strong>{t("guide.step5Title")}</strong> {t("guide.step5Text")}
        </li>
        <li>
          <strong>{t("guide.step6Title")}</strong> {t("guide.step6Text")}
        </li>
      </ol>

      <p className="hint">{t("guide.reopen")}</p>

      <div className="row end setup-foot">
        <button className="btn primary" onClick={onClose}>
          {t("guide.gotIt")}
        </button>
      </div>
    </Modal>
  );
}
