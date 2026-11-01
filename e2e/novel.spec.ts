/**
 * Phase 3: the writing loop (docs/testing.md section 5, phase 3 acceptance checks).
 * The mock AI echoes the direction and hint it was given ("Direction followed: …"),
 * so a test can see that they reached the prompt.
 */
import { expect, test } from "@playwright/test";
import { blocks, chapterText, MOCK_AI, openTab, panel, readyStory, switchKey, waitForBlock } from "./helpers";

const FIRST_ACTION = "Follow the stranger into the forest";

test("E2E-09: the first block streams in, a suggested action writes the next one, the setting locks", async ({
  page,
  request,
}) => {
  // A tagged key, so this test can read back its own request from the mock server.
  const key = `sk-test-valid~${test.info().testId}`;
  await readyStory(page, key);

  await expect(panel(page).getByRole("heading", { name: "Start chapter 1" })).toBeVisible();
  await panel(page).getByLabel(/Direction for the first block/).fill("He arrives at the sect gate at dawn.");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await expect(chapterText(page)).toContainText("Direction followed: He arrives at the sect gate at dawn.");
  // The suggestions are shown as buttons, never as part of the story text (spec 6.3).
  await expect(chapterText(page)).not.toContainText("=== NEXT ===");
  await expect(chapterText(page)).not.toContainText("MAIN CHARACTER DIED");
  const suggestions = panel(page).getByRole("group", { name: "Suggested next actions" }).getByRole("button");
  await expect(suggestions).toHaveCount(3);

  // The prompt carries the main character and the direction (spec 6.1).
  const sent = await request.get(`${MOCK_AI}/_last-request`, { headers: { Authorization: `Bearer ${key}` } });
  const body = JSON.stringify(await sent.json());
  expect(body).toContain("Lin Feng (main character)");
  expect(body).toContain("Direction: He arrives at the sect gate at dawn.");
  expect(body).toContain('"stream":true');

  await suggestions.filter({ hasText: FIRST_ACTION }).click();
  await waitForBlock(page, 2);
  await expect(blocks(page).nth(1)).toContainText(`Direction followed: ${FIRST_ACTION}`);

  // Spec 8.1: the setting is locked while the chapter has blocks.
  await openTab(page, "Setting");
  await expect(panel(page).getByText("The setting is locked while a chapter is being written.")).toBeVisible();
  await expect(panel(page).getByLabel(/Background summary of the world/)).toBeDisabled();
  await expect(panel(page).getByRole("button", { name: "Save setting" })).toBeDisabled();
});

test("E2E-10: typed direction, regenerate with a hint, restore a version, resume after a reload", async ({ page }) => {
  await readyStory(page);
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await expect(chapterText(page)).toContainText("Direction followed: none given.");

  await panel(page).getByLabel("Your direction for the next block").fill("She refuses the elder's offer.");
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  await waitForBlock(page, 2);
  const latest = blocks(page).nth(1);
  await expect(latest).toContainText("Direction followed: She refuses the elder's offer.");
  const original = (await latest.textContent()) ?? "";

  // Spec 5.2: regenerate the latest block with a hint.
  await panel(page).getByLabel("Regenerate hint").fill("make it shorter");
  await panel(page).getByRole("button", { name: "Regenerate block" }).click();
  await expect(panel(page).getByText("Version 2 of 2")).toBeVisible();
  await expect(blocks(page)).toHaveCount(2);
  await expect(latest).toContainText("Hint followed: make it shorter");
  await expect(latest).toContainText("Direction followed: She refuses the elder's offer.");

  // An earlier version can be restored.
  await panel(page).getByRole("button", { name: "Previous version" }).click();
  await expect(panel(page).getByText("Version 1 of 2")).toBeVisible();
  await expect(latest).toHaveText(original);

  // Spec 5.1: the draft is saved after every block and reopens as it was, chosen version included.
  await page.reload();
  await page.getByRole("button", { name: "Stories" }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await expect(blocks(page)).toHaveCount(2);
  await expect(blocks(page).nth(1)).toHaveText(original);
  await expect(panel(page).getByText("Version 1 of 2")).toBeVisible();
});

test("E2E-11: Stop cancels a block in progress and keeps the earlier blocks", async ({ page }) => {
  await readyStory(page);
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  const first = (await blocks(page).first().textContent()) ?? "";

  await switchKey(page, "sk-test-stream-slow");
  await panel(page).getByLabel("Your direction for the next block").fill("Climb the tower.");
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  // Part of the new block is on the page before Stop is pressed.
  await expect(chapterText(page).locator(".block.streaming")).toContainText("Mock block");
  await panel(page).getByRole("button", { name: "Stop" }).click();

  await expect(panel(page).getByText(/Stopped\. The unfinished block was discarded/)).toBeVisible();
  await expect(blocks(page)).toHaveCount(1);
  await expect(blocks(page).first()).toHaveText(first);
  await expect(panel(page).getByText("1 block", { exact: true })).toBeVisible();
});

test("E2E-12: errors are explained and leave the draft unchanged (spec 9)", async ({ page }) => {
  await readyStory(page);
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  const first = (await blocks(page).first().textContent()) ?? "";

  // The connection drops halfway through the block.
  await switchKey(page, "sk-test-stream-error");
  await panel(page).getByLabel("Your direction for the next block").fill("Climb the tower.");
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("The connection to the provider broke off");
  await expect(blocks(page)).toHaveCount(1);
  // The typed direction is kept, so the user can simply try again.
  await expect(panel(page).getByLabel("Your direction for the next block")).toHaveValue("Climb the tower.");

  // The network is off.
  await page.route("**/chat/completions", (route) => route.abort("internetdisconnected"));
  await panel(page).getByRole("button", { name: "Regenerate block" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("Could not reach the provider");
  await expect(panel(page).getByText(/Version \d of/)).toHaveCount(0);

  // Reopening shows the same single block: nothing reached the draft file.
  await page.reload();
  await page.getByRole("button", { name: "Stories" }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await expect(blocks(page)).toHaveCount(1);
  await expect(blocks(page).first()).toHaveText(first);
});

test("E2E-13: a block without suggestions, and a block with the died flag", async ({ page }) => {
  await readyStory(page, "sk-test-stream-malformed");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  // Decision 37: the story text is kept; the user types a direction instead.
  await expect(panel(page).getByText("No suggestions came with this block.")).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Suggested next actions" })).toHaveCount(0);
  // The mock ends this block with a bare flag line; readers never see it (decision 54).
  await expect(chapterText(page)).not.toContainText("MAIN CHARACTER DIED");

  await switchKey(page, "sk-test-stream-died");
  await panel(page).getByLabel("Your direction for the next block").fill("Walk into the ambush.");
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  await waitForBlock(page, 2);
  // The page pauses on the death (spec 5.5); E2E-19 follows the rest of the flow.
  await expect(panel(page).getByRole("heading", { name: "The main character died in this block" })).toBeVisible();
  await expect(chapterText(page)).not.toContainText("MAIN CHARACTER DIED");
});

test("E2E-24: the setting is locked while the first block is being written (spec 8.1, decision 61)", async ({ page }) => {
  await readyStory(page, "sk-test-stream-slow");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await expect(panel(page).getByRole("button", { name: "Stop" })).toBeVisible();

  await openTab(page, "Setting");
  await expect(panel(page).getByText(/The setting is locked while a chapter is being written/)).toBeVisible();
  await expect(panel(page).getByLabel(/Background summary of the world/)).toBeDisabled();
  await expect(panel(page).getByRole("button", { name: "Save setting" })).toBeDisabled();

  // Stopping the first block leaves the chapter empty, so the setting opens again.
  await openTab(page, "Novel");
  await panel(page).getByRole("button", { name: "Stop" }).click();
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toBeEnabled();
});
