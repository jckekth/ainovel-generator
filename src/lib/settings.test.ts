import { describe, expect, it } from "vitest";
import { deleteApiKey, getApiKey, setApiKey } from "./secrets";
import { applyAppearance, DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";
import { store } from "./storage";

describe("global settings", () => {
  it("gives the defaults when there is no settings file", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns a copy of the defaults, not the shared object", async () => {
    const loaded = await loadSettings();
    loaded.fontSize = 99;
    expect(DEFAULT_SETTINGS.fontSize).toBe(17);
  });

  it("round-trips saved settings", async () => {
    const settings = { ...DEFAULT_SETTINGS, model: "gpt-x", theme: "dark" as const, contextBudget: "rich" as const };
    await saveSettings(settings);
    expect(await loadSettings()).toEqual(settings);
  });

  it("fills in settings missing from an older file", async () => {
    await store.writeText("app-settings.json", JSON.stringify({ model: "old-model" }));
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, model: "old-model" });
  });

  it("shows the background art unless it was turned off (spec 12.3)", async () => {
    expect(DEFAULT_SETTINGS.backgroundArt).toBe(true);
    await store.writeText("app-settings.json", JSON.stringify({ backgroundArt: "yes" }));
    expect((await loadSettings()).backgroundArt).toBe(true);
    await saveSettings({ ...DEFAULT_SETTINGS, backgroundArt: false });
    expect((await loadSettings()).backgroundArt).toBe(false);
  });

  it("falls back to the defaults when the file is corrupt", async () => {
    await store.writeText("app-settings.json", "{oops");
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("never writes the API key into the settings file (decision 3)", async () => {
    await setApiKey("sk-secret-123");
    await saveSettings(await loadSettings());
    expect(await store.readText("app-settings.json")).not.toContain("sk-secret-123");
  });

  it("applies theme and font size to the page", () => {
    applyAppearance({ ...DEFAULT_SETTINGS, theme: "dark", fontSize: 21 });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--reading-size")).toBe("21px");
  });
});

describe("music settings (spec 9)", () => {
  it("are on at 50% by default, also for a settings file from before phase 8", async () => {
    await store.writeText("app-settings.json", JSON.stringify({ theme: "dark" }));
    const loaded = await loadSettings();
    expect(loaded.music).toBe(true);
    expect(loaded.musicVolume).toBe(50);
  });

  it("keep the volume between 0 and 100", async () => {
    await store.writeText("app-settings.json", JSON.stringify({ music: false, musicVolume: 250 }));
    expect(await loadSettings()).toMatchObject({ music: false, musicVolume: 100 });
    await store.writeText("app-settings.json", JSON.stringify({ musicVolume: "loud" }));
    expect((await loadSettings()).musicVolume).toBe(50);
  });
});

describe("API key in the browser preview", () => {
  it("is kept in sessionStorage only", async () => {
    expect(await getApiKey()).toBeNull();
    await setApiKey("sk-abc");
    expect(await getApiKey()).toBe("sk-abc");
    expect(localStorage.length).toBe(0);
    await deleteApiKey();
    expect(await getApiKey()).toBeNull();
  });
});

describe("UI language (spec 11)", () => {
  it("starts from the system language and keeps a saved choice", async () => {
    expect((await loadSettings()).uiLanguage).toBe("en"); // jsdom says en-US
    await saveSettings({ ...DEFAULT_SETTINGS, uiLanguage: "zh-Hant" });
    expect((await loadSettings()).uiLanguage).toBe("zh-Hant");
  });

  it("replaces an unknown language in the file", async () => {
    await store.writeText("app-settings.json", JSON.stringify({ uiLanguage: "klingon" }));
    expect((await loadSettings()).uiLanguage).toBe("en");
  });
});
