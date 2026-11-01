/** True when the app runs inside the Tauri shell, false in a plain browser (npm run dev). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Calls back when the window is hidden or shown again: the page hidden, or, in
 * the app, the window minimised, which a webview does not always report as hidden.
 * Returns a function that stops listening.
 */
export function onWindowHidden(callback: (hidden: boolean) => void): () => void {
  let minimized = false;
  const report = () => callback(document.hidden || minimized);
  document.addEventListener("visibilitychange", report);
  let stopped = false;
  let unlisten: (() => void) | undefined;
  if (isTauri()) {
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const off = await win.onResized(async () => {
        minimized = await win.isMinimized();
        report();
      });
      if (stopped) off();
      else unlisten = off;
    });
  }
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", report);
    unlisten?.();
  };
}

/** Opens a folder in the system file explorer. Does nothing in a browser. */
export async function openFolder(path: string): Promise<void> {
  if (!isTauri()) return;
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openPath(path);
}

/** Opens a web page in the default browser, outside the app window. */
export async function openLink(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openUrl(url);
}
