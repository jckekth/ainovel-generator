/**
 * Phase 5b: fixes before v0.1 (docs/testing.md section 5, phase 5b acceptance
 * checks). The mock AI's End Chapter answer suggests two openings for the next
 * chapter, "Train with Elder Wu at dawn (after chapter N)" and "Go back down
 * the mountain to the village" (scripts/mock-ai-server.mjs).
 */
import { expect, Page, test } from "@playwright/test";
import { blocks, createStory, openApp, openTab, panel, readyStory, saveSetting, setUpMockAi, startCharacter, waitForBlock } from "./helpers";

async function endChapter(page: Page) {
  await panel(page).getByRole("button", { name: "End Chapter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End Chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: /has ended/ })).toBeVisible();
}

/** Writes chapter 1 in one block, rejects every proposal and finishes it. */
async function finishFirstChapter(page: Page) {
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await endChapter(page);
  for (const item of await panel(page).locator(".proposal").all()) await item.getByRole("button", { name: "Reject" }).click();
  await panel(page).getByRole("button", { name: "Finish chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: "Start chapter 2" })).toBeVisible();
}

test("E2E-28: progress and End Chapter stay in view on a long chapter, and look unlike other buttons (spec 5.1, decision 64)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await readyStory(page, "sk-test-stream-long");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await panel(page).getByLabel("Your direction for the next block").fill("Walk on");
  await panel(page).getByRole("button", { name: "Write next block" }).click();
  await waitForBlock(page, 2);

  // Scrolled to the top of a long chapter, the bar is still on screen.
  await blocks(page).first().scrollIntoViewIfNeeded();
  await page.locator(".main").evaluate((el) => el.scrollTo(0, 0));
  const bar = panel(page).getByRole("region", { name: "Chapter progress" });
  await expect(bar.getByRole("progressbar", { name: "Chapter length" })).toBeInViewport();
  await expect(bar.getByRole("button", { name: "End Chapter" })).toBeInViewport();
  await expect(blocks(page).last()).not.toBeInViewport();

  // Decision 95 (replacing the colours of decision 64): solid, and told apart by its own icon.
  const icon = (name: string) => panel(page).getByRole("button", { name }).locator("svg").evaluate((el) => el.innerHTML);
  expect(await icon("End Chapter")).not.toBe(await icon("Write next block"));
  const background = await bar.getByRole("button", { name: "End Chapter" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
});

test("E2E-29: chapter 2 starts with an empty direction (spec 5.1, decision 65)", async ({ page }) => {
  await readyStory(page);
  await finishFirstChapter(page);
  await expect(panel(page).getByLabel(/Direction for the first block/)).toHaveValue("");
  await expect(panel(page).getByText("(optional)")).toBeVisible();
  await panel(page).getByRole("button", { name: "Start chapter 2" }).click();
  await waitForBlock(page, 1);
  await expect(blocks(page).first()).toContainText("Direction followed: none given. Open the chapter where the previous one left off");
});

test("E2E-30: chapter 2 starts from an opening the End Chapter call suggested (spec 5.1, decision 65)", async ({ page }) => {
  await readyStory(page);
  await finishFirstChapter(page);
  const openings = panel(page).getByRole("group", { name: "Chapter openings" });
  await expect(openings.getByRole("button")).toHaveCount(2);
  await openings.getByRole("button", { name: "Go back down the mountain to the village" }).click();
  await waitForBlock(page, 1);
  await expect(blocks(page).first()).toContainText("Direction followed: Go back down the mountain to the village");
  // Once the chapter has begun, the openings are gone.
  await expect(panel(page).getByRole("group", { name: "Chapter openings" })).toHaveCount(0);
});

test("E2E-31: a romance new character the AI gave no age is accepted without typing (spec 7.5, decision 67)", async ({
  page,
}) => {
  await openApp(page);
  await setUpMockAi(page, "sk-test-new-character-no-age");
  await createStory(page, "Harbour Lane", "Romance");
  await saveSetting(page, "A small harbour town with one old café.");
  await startCharacter(page, true);
  await panel(page).getByRole("button", { name: "Create character" }).click();
  await expect(panel(page).getByRole("button", { name: /Main character/ })).toBeVisible();
  await openTab(page, "Novel");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await endChapter(page);

  const wu = panel(page).getByRole("listitem").filter({ hasText: /New character: Elder Wu/ });
  await expect(wu).toContainText("The AI gave no age, so it was set to 25.");
  await wu.getByRole("button", { name: "Accept" }).click();
  await expect(wu.getByText("Approved")).toBeVisible();

  await openTab(page, "Characters");
  await panel(page).getByRole("button", { name: /Elder Wu/ }).click();
  await expect(panel(page).getByLabel(/^Age/)).toHaveValue("25");
});
