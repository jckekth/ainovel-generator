/**
 * Error messages for the user (spec 9). The app's own errors are already
 * written in plain words; this turns the common system ones (a read-only
 * data folder, a full disk, browser storage that is full, a password store
 * that cannot be reached) into plain words with the next step.
 */

import { t } from "../i18n";
import { AiError } from "./ai";

export function errorText(e: unknown): string {
  // AI errors are already plain words and may quote the provider, whose
  // "exceeded your current quota" means no credit, not full storage (decision 58).
  if (e instanceof AiError) return e.message;

  const raw = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";

  // The keyring crate's errors, and the D-Bus ones under them when Linux has no
  // Secret Service running (decision 93). Checked first: a D-Bus "AccessDenied"
  // is about the keyring, not the data folder.
  if (/platform secure storage|org.freedesktop.(secrets|DBus.Error)|secret service/i.test(raw)) {
    return t("error.noKeyring");
  }
  if (name === "QuotaExceededError" || /quota/i.test(raw)) {
    return t("error.storageFull");
  }
  if (/permission denied|access is denied|os error 5\b|EACCES|EPERM|read-only file system/i.test(raw)) {
    return t("error.noPermission");
  }
  if (/no space|disk full|os error (28|39|112)\b|ENOSPC/i.test(raw)) {
    return t("error.diskFull");
  }
  if (/os error (2|3)\b|ENOENT|cannot find the (file|path)|file not found/i.test(raw)) {
    return t("error.missingFile", { detail: raw });
  }
  return raw;
}
