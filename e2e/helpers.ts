import { expect, Page } from "@playwright/test";

/** Base URL of scripts/mock-ai-server.mjs. Keys there select how it answers. */
export const MOCK_AI = "http://127.0.0.1:8787/v1";

/** The visible tab panel of a story. Hidden panels stay mounted, so always scope to this. */
export const panel = (page: Page) => page.getByRole("tabpanel");

/** Closes the setup guide that a first launch opens, so it does not cover later clicks (decision 82). */
export async function closeGuide(page: Page) {
  const guide = page.getByRole("dialog", { name: "Set up your AI connection" });
  await guide.getByRole("button", { name: "Got it" }).click();
  await expect(guide).toBeHidden();
}

/** Opens the app on a first launch, past the setup guide. */
export async function openApp(page: Page) {
  await page.goto("/");
  await closeGuide(page);
}

export async function saveKey(page: Page, key = "sk-test-valid") {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("Key saved.")).toBeVisible();
}

export async function useMockAi(page: Page) {
  const url = page.getByLabel("Base URL", { exact: true });
  await url.fill(MOCK_AI);
  await url.blur();
}

/** Creates a story from the story list and waits for its workspace. */
export async function createStory(page: Page, title: string, type: "Cultivation" | "Romance" | "Fantasy" | "General" = "Cultivation") {
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: "New story" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByText(type, { exact: true }).click();
  await dialog.getByRole("button", { name: "Create story" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

export async function openTab(page: Page, name: "Novel" | "Characters" | "Setting") {
  await page.getByRole("tab", { name }).click();
}

export async function saveSetting(page: Page, background = "A world of floating mountains and old sects.") {
  await openTab(page, "Setting");
  await panel(page).getByLabel(/Background summary of the world/).fill(background);
  await panel(page).getByRole("button", { name: "Save setting" }).click();
  await expect(panel(page).getByText("Setting saved.")).toBeVisible();
}

/** Opens a new character form. Fill it, then click "Create character". */
export async function startCharacter(page: Page, main: boolean) {
  await openTab(page, "Characters");
  await panel(page).getByRole("button", { name: main ? "Create main character" : "Add character" }).click();
}

/** Points the app at the mock AI with a model and the given key. Starts and ends on Settings. */
export async function setUpMockAi(page: Page, key = "sk-test-valid") {
  await page.getByRole("button", { name: "Settings" }).click();
  await useMockAi(page);
  const model = page.getByLabel("Model", { exact: true });
  await model.fill("mock-novelist-v1");
  await model.blur();
  await saveKey(page, key);
}

/**
 * Creates a cultivation main character called Lin Feng. The form starts as the
 * story's random curated set (decision 85), so the fields tests read are filled in.
 */
export async function createMainCharacter(page: Page, name = "Lin Feng") {
  await startCharacter(page, true);
  const form = panel(page);
  await form.getByLabel(/^Name/).fill(name);
  await form.getByLabel(/^Special ability/).fill("Can see the flow of qi.");
  await form.getByLabel(/^Condition/).fill("Healthy");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByRole("button", { name: new RegExp(`${name}.*Main character`) })).toBeVisible();
}

/** A story with a setting and a main character, open on the Novel tab, using the mock AI. */
export async function readyStory(page: Page, key = "sk-test-valid", title = "Azure Peaks") {
  await openApp(page);
  await setUpMockAi(page, key);
  await createStory(page, title);
  await saveSetting(page);
  await createMainCharacter(page);
  await openTab(page, "Novel");
}

/** Saves another key, then reopens the story on the Novel tab. */
export async function switchKey(page: Page, key: string, title = "Azure Peaks") {
  await saveKey(page, key);
  await page.getByRole("button", { name: "Stories" }).click();
  await page.getByRole("button", { name: new RegExp(`^Open ${title}`) }).click();
  await openTab(page, "Novel");
}

/** The chapter's reading view and its blocks. */
export const chapterText = (page: Page) => panel(page).getByRole("article", { name: "Chapter text" });
export const blocks = (page: Page) => chapterText(page).locator(".block");

/** Waits until the block being written has arrived and the controls are back. */
export async function waitForBlock(page: Page, count: number) {
  await expect(panel(page).getByText(count === 1 ? "1 block" : `${count} blocks`)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Stop" })).toHaveCount(0);
}
