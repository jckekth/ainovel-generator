/**
 * Phase 4: chapters, End Chapter, the review, the story's ending (docs/testing.md
 * section 5, phase 4 acceptance checks). The mock AI's End Chapter answer always
 * proposes "condition: Wounded in the left arm" for the main character and a new
 * character "Elder Wu" (scripts/mock-ai-server.mjs).
 */
import { expect, Page, test } from "@playwright/test";
import { blocks, chapterText, openTab, panel, readyStory, switchKey, waitForBlock } from "./helpers";

async function startChapter(page: Page, n = 1) {
  await panel(page).getByRole("button", { name: `Start chapter ${n}` }).click();
  await waitForBlock(page, 1);
}

async function endChapter(page: Page) {
  await panel(page).getByRole("button", { name: "End Chapter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End Chapter" }).click();
}

const proposal = (page: Page, text: RegExp) => panel(page).getByRole("listitem").filter({ hasText: text });

/** Rejects every proposal and finishes the chapter. */
async function finishChapter(page: Page) {
  await expect(panel(page).getByRole("heading", { name: /has ended/ })).toBeVisible();
  for (const text of [/Lin Feng · Condition/, /New character: Elder Wu/]) {
    await proposal(page, text).getByRole("button", { name: "Reject" }).click();
    await expect(proposal(page, text).getByText("Rejected")).toBeVisible();
  }
  await panel(page).getByRole("button", { name: "Finish chapter" }).click();
}

test("E2E-16: End Chapter, review with title edit, chapter list and read-only chapter (spec 5.4, 5.6)", async ({
  page,
}) => {
  await readyStory(page);
  await startChapter(page);
  // The story text alone; the writing page also shows the block's tokens (spec 6.6).
  const firstBlock = (await blocks(page).first().locator("p:not(.block-tokens)").allTextContents()).join("");
  await endChapter(page);

  // The review: the AI's title, its summary and the checked proposals (the invalid one is dropped).
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 has ended" })).toBeVisible();
  await expect(panel(page).getByLabel("Chapter title")).toHaveValue("Mock chapter 1");
  await expect(panel(page).getByText("In mock chapter 1, Lin Feng walked through the mist")).toBeVisible();
  await expect(panel(page).locator(".proposal")).toHaveCount(2);
  await expect(panel(page).getByRole("button", { name: "Finish chapter" })).toBeDisabled();
  // The setting stays locked until the review is finished.
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toBeDisabled();
  await openTab(page, "Novel");

  // Approve one, reject one.
  const change = proposal(page, /Lin Feng · Condition/);
  await expect(change).toContainText("Healthy → Wounded in the left arm");
  await change.getByRole("button", { name: "Approve" }).click();
  await expect(change.getByText("Approved")).toBeVisible();
  await proposal(page, /New character: Elder Wu/).getByRole("button", { name: "Reject" }).click();
  await panel(page).getByLabel("Chapter title").fill("The Misty Gate");
  await panel(page).getByRole("button", { name: "Finish chapter" }).click();

  // Chapter 2 starts; the setting is editable again.
  await expect(panel(page).getByRole("heading", { name: "Start chapter 2" })).toBeVisible();
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toBeEnabled();
  await expect(panel(page).getByText("The setting is locked")).toHaveCount(0);
  await openTab(page, "Characters");
  await panel(page).getByRole("button", { name: /Lin Feng/ }).click();
  await expect(panel(page).getByLabel(/^Condition/)).toHaveValue("Wounded in the left arm");
  await expect(panel(page).getByRole("button", { name: /Elder Wu/ })).toHaveCount(0);

  // The chapter list opens the finished chapter read-only.
  await openTab(page, "Novel");
  const list = panel(page).getByRole("navigation", { name: "Chapters" });
  await list.getByRole("button", { name: "1. The Misty Gate" }).click();
  await expect(panel(page).getByRole("heading", { name: "The Misty Gate" })).toBeVisible();
  await expect(panel(page).getByText("Chapter 1 · read-only")).toBeVisible();
  await expect(chapterText(page)).toHaveText(firstBlock);
  await expect(panel(page).getByRole("button", { name: /Regenerate|Write next block|End Chapter/ })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Back to the current chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: "Start chapter 2" })).toBeVisible();
});

test("E2E-17: the progress bar, the soft limit and the hard limit (spec 5.3)", async ({ page }) => {
  await readyStory(page, "sk-test-stream-long");
  await openTab(page, "Setting");
  await panel(page).getByText("Short", { exact: true }).click();
  await panel(page).getByRole("button", { name: "Save setting" }).click();
  await expect(panel(page).getByText("Setting saved.")).toBeVisible();
  await openTab(page, "Novel");

  const bar = panel(page).getByRole("progressbar", { name: "Chapter length" });
  await expect(panel(page).getByText("0 of 1,500 words")).toBeVisible();
  await startChapter(page);
  await expect(panel(page).getByRole("button", { name: "End Chapter" })).not.toHaveClass(/ready/);

  const next = async (n: number) => {
    await panel(page).getByLabel("Your direction for the next block").fill(`Walk on ${n}`);
    await panel(page).getByRole("button", { name: "Write next block" }).click();
    await waitForBlock(page, n);
  };
  await next(2);
  // Past the target: End Chapter is highlighted (decision 64).
  await expect(panel(page).getByText(/of 1,500 words · target reached/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "End Chapter" })).toHaveClass(/ready/);
  await next(3);
  await expect(panel(page).getByText(/length limit reached/)).toBeVisible();
  // The block written at the hard limit concludes the chapter; then only End Chapter is left (decision 49).
  await next(4);
  await expect(panel(page).getByRole("heading", { name: "The chapter has reached its length limit" })).toBeVisible();
  await expect(panel(page).getByLabel("Your direction for the next block")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Regenerate block" })).toBeVisible();
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(2250);
  await endChapter(page);
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 has ended" })).toBeVisible();
});

test("E2E-18: a failed End Chapter call keeps the chapter and can be retried (spec 5.4)", async ({ page }) => {
  await readyStory(page, "sk-test-end-chapter-fail");
  await startChapter(page);
  await endChapter(page);
  await expect(panel(page).getByRole("alert")).toContainText("Mock End Chapter failure");
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 is saved" })).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Start chapter 2" })).toHaveCount(0);
  await expect(panel(page).getByRole("navigation", { name: "Chapters" })).toContainText("summary pending");

  await switchKey(page, "sk-test-valid");
  await panel(page).getByRole("button", { name: "Try the summary again" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 has ended" })).toBeVisible();
});

test("E2E-33: End Chapter runs behind a progress dialog whose Stop leaves the chapter for one Retry (decisions 77, 88)", async ({
  page,
}) => {
  await readyStory(page);
  await startChapter(page);
  await switchKey(page, "sk-test-stream-slow");
  await endChapter(page);
  const progress = page.getByRole("dialog", { name: "Ending chapter 1" });
  await expect(progress.getByRole("status")).toHaveText("Writing the summary and character changes…");
  await expect(progress).toContainText("the chapter stays saved");

  // Stop ends the call; the chapter is saved and waits for one Retry.
  await progress.getByRole("button", { name: "Stop" }).click();
  await expect(progress).toBeHidden();
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 is saved" })).toBeVisible();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await switchKey(page, "sk-test-valid");
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 is saved" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Try the summary again" }).click();
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 has ended" })).toBeVisible();
});

test("E2E-32: End Chapter without credit says so, not that storage is full (spec 9, decision 58)", async ({ page }) => {
  await readyStory(page);
  await startChapter(page);
  await switchKey(page, "sk-test-no-credit");
  await endChapter(page);
  const alert = panel(page).getByRole("alert");
  await expect(alert).toContainText("The account has no credit left. Add credit on the provider's website");
  await expect(alert).toContainText("quota");
  await expect(alert).not.toContainText("storage is full");
  await expect(panel(page).getByRole("heading", { name: "Chapter 1 is saved" })).toBeVisible();
});

test("E2E-19: an accepted death ends the chapter, the epilogue completes the story (spec 5.5)", async ({ page }) => {
  await readyStory(page, "sk-test-stream-died");
  await startChapter(page);
  await expect(panel(page).getByRole("heading", { name: "The main character died in this block" })).toBeVisible();
  await expect(panel(page).getByLabel("Your direction for the next block")).toHaveCount(0);

  await panel(page).getByRole("button", { name: "Accept the death" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept the death" }).click();
  await finishChapter(page);

  // The epilogue, with an optional direction; regenerate, then accept.
  await expect(panel(page).getByRole("heading", { name: "Write the epilogue" })).toBeVisible();
  await expect(panel(page).getByText("The main character has died.")).toBeVisible();
  await panel(page).getByLabel(/Direction for the epilogue/).fill("Show the funeral");
  await panel(page).getByRole("button", { name: "Write the epilogue" }).click();
  await expect(chapterText(page)).toContainText("Direction followed: Show the funeral");
  await panel(page).getByRole("button", { name: "Regenerate epilogue" }).click();
  await expect(panel(page).getByText("Version 2 of 2")).toBeVisible();
  await panel(page).getByRole("button", { name: "Accept the epilogue" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept the epilogue" }).click();

  await expect(panel(page).getByRole("heading", { name: "The story is complete" })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: /Start chapter/ })).toHaveCount(0);
  const list = panel(page).getByRole("navigation", { name: "Chapters" });
  // A completed story has no current chapter in the side list (spec 12.1).
  await expect(list.getByRole("button")).toHaveCount(2);
  await expect(list.getByRole("button", { name: "1. Mock chapter 1" })).toBeVisible();
  await list.getByRole("button", { name: "2. Epilogue" }).click();
  await expect(chapterText(page)).toContainText("Mock epilogue");
});

test("E2E-20: End story between chapters leads to the epilogue (spec 5.5)", async ({ page }) => {
  await readyStory(page);
  await expect(panel(page).getByRole("button", { name: "End story" })).toHaveCount(0); // not before chapter 1
  await startChapter(page);
  await endChapter(page);
  await finishChapter(page);

  await panel(page).getByRole("button", { name: "End story" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End story" }).click();
  await expect(panel(page).getByRole("heading", { name: "Write the epilogue" })).toBeVisible();
  await expect(panel(page).getByText("The main character has died.")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Write the epilogue" }).click();
  await panel(page).getByRole("button", { name: "Accept the epilogue" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept the epilogue" }).click();
  await expect(panel(page).getByRole("heading", { name: "The story is complete" })).toBeVisible();
});

test("E2E-25: an edited chapter title survives leaving the review and a reload (spec 5.4, decision 60)", async ({
  page,
}) => {
  await readyStory(page);
  await startChapter(page);
  await endChapter(page);
  const title = panel(page).getByLabel("Chapter title");
  await expect(title).toHaveValue("Mock chapter 1");

  // Leaving the story straight after typing keeps the title.
  await title.fill("The Misty Gate");
  await page.getByRole("button", { name: "All stories" }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await expect(title).toHaveValue("The Misty Gate");

  // So does a reload, once typing has paused.
  await title.fill("The Gate in the Mist");
  await page.waitForTimeout(1000);
  await page.reload();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await expect(title).toHaveValue("The Gate in the Mist");

  await finishChapter(page);
  const list = panel(page).getByRole("navigation", { name: "Chapters" });
  await expect(list.getByRole("button", { name: "1. The Gate in the Mist" })).toBeVisible();
});

test("E2E-27: under Never, a death the AI wrote can only be regenerated (spec 5.5, decision 62)", async ({ page }) => {
  await readyStory(page, "sk-test-stream-died");
  await openTab(page, "Setting");
  await panel(page).getByRole("group", { name: /Main character death/ }).getByText("Never", { exact: true }).click();
  await panel(page).getByRole("button", { name: "Save setting" }).click();
  await expect(panel(page).getByText("Setting saved.")).toBeVisible();
  await openTab(page, "Novel");

  await startChapter(page);
  await expect(panel(page).getByRole("heading", { name: "The main character died in this block" })).toBeVisible();
  await expect(panel(page).getByText(/set to Never for this story, so the death cannot be accepted/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Accept the death" })).toHaveCount(0);
  await expect(panel(page).getByLabel("Your direction for the next block")).toHaveCount(0);

  // Regenerating is the way on; the mock writes another death, so the page still pauses with no way to accept.
  await panel(page).getByRole("button", { name: "Regenerate the block" }).click();
  await expect(panel(page).getByText(/Version 2 of 2/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Accept the death" })).toHaveCount(0);
});
