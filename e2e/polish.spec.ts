/**
 * Phase 5: errors in plain words, and no silent loss of Setting edits
 * (docs/testing.md section 5, phase 5).
 */
import { expect, test } from "@playwright/test";
import { blocks, createStory, openApp, openTab, panel, readyStory, saveSetting, switchKey, waitForBlock } from "./helpers";

test.describe("E2E-21: every mock error names the problem and the next step (spec 9)", () => {
  const cases: [string, RegExp][] = [
    ["sk-wrong", /The API key was rejected\. Check that it is copied in full.*The provider said: “Incorrect API key provided\.”/],
    ["sk-test-forbidden", /not allowed to use this service\. Check the key's permissions/],
    ["sk-test-rate-limit", /too many requests from this key. Wait a minute and try again/],
    ["sk-test-no-credit", /no credit left. Add credit on the provider.s website, then try again. The provider said: “You exceeded your current quota/],
    ["sk-test-server-error", /server error \(500\)\. Try again in a moment/],
    ["sk-test-bad-json", /not in the expected format\. Check that the base URL is an OpenAI-compatible API/],
    ["sk-test-stream-error", /broke off while the block was being written\. Try again/],
    // Decision 74: a cut-off answer is an error, not a short block.
    ["sk-test-stream-cut", /broke off while the block was being written\. Try again/],
    ["sk-test-stream-length", /cut the answer off at its output limit, so it was not saved\. Try again, or choose a model/],
  ];
  for (const [key, message] of cases) {
    test(key, async ({ page }) => {
      await readyStory(page);
      await switchKey(page, key);
      await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
      await expect(panel(page).getByRole("alert")).toHaveText(message);
      // Nothing was written, so the chapter can still be started.
      await expect(panel(page).getByRole("button", { name: "Start chapter 1" })).toBeVisible();
    });
  }

  test("no key", async ({ page }) => {
    await readyStory(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("button", { name: "Stories", exact: true }).click();
    await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
    await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
    await expect(panel(page).getByRole("alert")).toHaveText("There is no API key yet. Add one in Settings, then try again.");
  });
});

test("E2E-22: leaving a story with unsaved Setting edits asks first (spec 9)", async ({ page }) => {
  await openApp(page);
  await createStory(page, "Unsaved Edits");
  await saveSetting(page, "The first world.");
  await panel(page).getByLabel(/Background summary of the world/).fill("A changed world.");

  // "← All stories" asks; Keep editing goes back to the Setting tab with the edit intact.
  await openTab(page, "Novel");
  await page.getByRole("button", { name: "All stories" }).click();
  const dialog = page.getByRole("dialog", { name: "Discard your setting changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("tab", { name: "Setting" })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toHaveValue("A changed world.");

  // The rail asks too; Discard leaves, and the saved setting is unchanged.
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: /^Open Unsaved Edits/ }).click();
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toHaveValue("The first world.");

  // Saved edits leave without asking.
  await page.getByRole("button", { name: "All stories" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your stories" })).toBeVisible();
});

test("E2E-23: a typed direction survives leaving the story; leaving mid-block asks first (decision 59)", async ({ page }) => {
  await readyStory(page);
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  const direction = panel(page).getByLabel("Your direction for the next block");
  const hint = panel(page).getByLabel("Regenerate hint");

  // An error sends the user to Settings; the direction and hint are there when they come back.
  await switchKey(page, "sk-test-server-error");
  await direction.fill("Climb the tower.");
  await hint.fill("more rain");
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("server error");
  await switchKey(page, "sk-test-stream-slow");
  await expect(direction).toHaveValue("Climb the tower.");
  await expect(hint).toHaveValue("more rain");

  // Leaving while a block is being written asks first; Stay keeps it going.
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  await expect(panel(page).getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "All stories" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave while a block is being written?" });
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(panel(page).getByRole("button", { name: "Stop" })).toBeVisible();

  // Leaving from the rail discards the block; the chapter and the direction are as they were.
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await dialog.getByRole("button", { name: "Leave and discard the block" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your stories" })).toBeVisible();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await expect(blocks(page)).toHaveCount(1);
  await expect(direction).toHaveValue("Climb the tower.");

  // A written block clears both.
  await switchKey(page, "sk-test-valid");
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  await waitForBlock(page, 2);
  await expect(direction).toHaveValue("");
  await expect(hint).toHaveValue("");
});
