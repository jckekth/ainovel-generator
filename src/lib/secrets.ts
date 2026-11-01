/**
 * The user's API keys: the text AI's, and the image provider's (spec 14.1).
 *
 * In the app it lives in the operating system's credential store, through the
 * Rust commands in src-tauri/src/lib.rs. It is never written to a settings file.
 *
 * In a plain browser (npm run dev) there is no credential store, so the key is
 * held in sessionStorage and is gone when the tab closes.
 */
import { isTauri } from "./platform";

const DEV_KEY = "ang-dev-api-key";
const DEV_IMAGE_KEY = "ang-dev-image-key";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export async function getApiKey(): Promise<string | null> {
  if (!isTauri()) return sessionStorage.getItem(DEV_KEY);
  return invoke<string | null>("get_api_key");
}

export async function setApiKey(key: string): Promise<void> {
  if (!isTauri()) {
    sessionStorage.setItem(DEV_KEY, key);
    return;
  }
  await invoke("set_api_key", { key });
}

export async function deleteApiKey(): Promise<void> {
  if (!isTauri()) {
    sessionStorage.removeItem(DEV_KEY);
    return;
  }
  await invoke("delete_api_key");
}

/** The image provider's own key (spec 14.1), kept apart from the text key. */
export async function getImageKey(): Promise<string | null> {
  if (!isTauri()) return sessionStorage.getItem(DEV_IMAGE_KEY);
  return invoke<string | null>("get_image_key");
}

export async function setImageKey(key: string): Promise<void> {
  if (!isTauri()) {
    sessionStorage.setItem(DEV_IMAGE_KEY, key);
    return;
  }
  await invoke("set_image_key", { key });
}

export async function deleteImageKey(): Promise<void> {
  if (!isTauri()) {
    sessionStorage.removeItem(DEV_IMAGE_KEY);
    return;
  }
  await invoke("delete_image_key");
}
