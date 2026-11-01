/**
 * Phase 8: pictures (spec 14, decisions 140–147). The mock AI writes a picture
 * line when the prompt asks for one, answers picture requests with a small PNG,
 * and refuses every picture for sk-test-image-refused (scripts/mock-ai-server.mjs).
 * Each picture place carries data-picture: "drawing", "shown", "failed" or "make".
 */
import { expect, Page, test } from "@playwright/test";
import { blocks, MOCK_AI, openTab, panel, readyStory, waitForBlock } from "./helpers";

const picturesPanel = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Pictures", exact: true }) });

/** Sets the Pictures level and the image provider (the mock AI with its own key), then reopens the story. */
async function setUpPictures(page: Page, level: "None" | "Lite" | "Rich", imageKey: string) {
  await page.getByRole("button", { name: "Settings" }).click();
  const pictures = picturesPanel(page);
  await pictures.getByRole("group", { name: "Pictures of the story" }).getByText(level, { exact: true }).click();
  await pictures.getByLabel("Image API key", { exact: true }).fill(imageKey);
  await pictures.getByRole("button", { name: "Save image key" }).click();
  await expect(pictures.getByText("Key saved.")).toBeVisible();
  const url = pictures.getByLabel("Image base URL", { exact: true });
  await url.fill(MOCK_AI);
  await url.blur();
  const model = pictures.getByLabel("Image model", { exact: true });
  await model.fill("mock-image-1");
  await model.blur();
  await page.getByRole("button", { name: "Stories" }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await openTab(page, "Novel");
}

async function writeBlock(page: Page, direction: string, count: number) {
  await panel(page).getByLabel(count === 1 ? /Direction for the first block/ : "Your direction for the next block").fill(direction);
  await panel(page).getByRole("button", { name: count === 1 ? "Start chapter 1" : "Write next block" }).click();
  await waitForBlock(page, count);
}

async function endAndFinishChapter(page: Page) {
  await panel(page).getByRole("button", { name: "End Chapter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End Chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: /has ended/ })).toBeVisible();
  for (const text of [/Lin Feng · Condition/, /New character: Elder Wu/]) {
    const item = panel(page).getByRole("listitem").filter({ hasText: text });
    await item.getByRole("button", { name: "Reject" }).click();
    await expect(item.getByText("Rejected")).toBeVisible();
  }
  await panel(page).getByRole("button", { name: "Finish chapter" }).click();
}

const lastImageRequest = (page: Page, key: string) =>
  page.request.get(`${MOCK_AI}/_last-image-request`, { headers: { Authorization: `Bearer ${key}` } });

test("E2E-60: Settings shows the cost before pictures are on, and the image connection test finds the model", async ({ page }) => {
  await readyStory(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const pictures = picturesPanel(page);
  await expect(pictures.getByRole("group", { name: "Pictures of the story" }).getByRole("radio", { name: /None/ })).toBeChecked();
  await expect(pictures.getByText(/About \$0\.006 per picture with gpt-image-1-mini/)).toBeVisible();
  await pictures.getByRole("group", { name: "Picture quality" }).getByText("Medium", { exact: true }).click();
  await expect(pictures.getByText(/About \$0\.015 per picture/)).toBeVisible();

  await pictures.getByLabel("Image API key", { exact: true }).fill("sk-test-valid");
  await pictures.getByRole("button", { name: "Save image key" }).click();
  const url = pictures.getByLabel("Image base URL", { exact: true });
  await url.fill(MOCK_AI);
  await url.blur();
  const model = pictures.getByLabel("Image model", { exact: true });
  await model.fill("mock-image-1");
  await model.blur();
  await expect(pictures.getByText(/does not know the price of mock-image-1/)).toBeVisible();
  await pictures.getByRole("button", { name: "Test image connection" }).click();
  await expect(pictures.getByText("Connected. mock-image-1 is available.")).toBeVisible();
});

test("E2E-61: Rich puts a picture under every block, and the finished chapter keeps them in the reader", async ({ page }) => {
  await readyStory(page);
  const key = "sk-test-valid~rich";
  await setUpPictures(page, "Rich", key);

  await writeBlock(page, "He walks to the sect gate at dawn.", 1);
  await expect(blocks(page).nth(0).locator('[data-picture="shown"] img')).toBeVisible();
  const sent = await (await lastImageRequest(page, key)).json();
  expect(sent.model).toBe("mock-image-1");
  expect(sent.size).toBe("1536x1024");
  expect(sent.prompt).toContain("Style: Chinese ink and colour wash painting");
  expect(sent.prompt).toMatch(/Scene: Lin Feng stands between two old stones/);
  // The set's main character comes with an appearance, sent with every picture of him (decision 145).
  expect(sent.prompt).toContain("- Lin Feng:");

  await writeBlock(page, "He knocks on the gate.", 2);
  await expect(blocks(page).locator('[data-picture="shown"] img')).toHaveCount(2);

  await endAndFinishChapter(page);
  await panel(page).getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: "1. Mock chapter 1" }).click();
  await expect(panel(page).getByRole("article", { name: "Chapter text" }).locator('[data-picture="shown"] img')).toHaveCount(2);
});

test("E2E-62: a refused picture says why with Try again, and the story and writing carry on", async ({ page }) => {
  await readyStory(page);
  await setUpPictures(page, "Rich", "sk-test-image-refused");

  await writeBlock(page, "He walks to the sect gate at dawn.", 1);
  const place = blocks(page).nth(0).locator('[data-picture="failed"]');
  await expect(place).toContainText("safety rules refused this picture");
  await expect(place.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(blocks(page).nth(0)).toContainText("Mock block");

  // Writing the next block never waits for, or is stopped by, a picture.
  await writeBlock(page, "He knocks on the gate.", 2);
  await expect(blocks(page)).toHaveCount(2);
  await place.getByRole("button", { name: "Try again" }).click();
  await expect(blocks(page).nth(0).locator('[data-picture="failed"]')).toBeVisible();
});

test("E2E-63: Lite makes one picture at End Chapter, shown in the review and at the top of the chapter", async ({ page }) => {
  await readyStory(page);
  await setUpPictures(page, "Lite", "sk-test-valid~lite");

  await writeBlock(page, "He walks to the sect gate at dawn.", 1);
  await expect(blocks(page).nth(0).locator("[data-picture]")).toHaveCount(0);

  await panel(page).getByRole("button", { name: "End Chapter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End Chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: /has ended/ })).toBeVisible();
  await expect(panel(page).locator('[data-picture="shown"] img')).toBeVisible();
  const sent = await (await lastImageRequest(page, "sk-test-valid~lite")).json();
  expect(sent.prompt).toContain("Scene: Lin Feng meets Elder Wu in the mist (mock chapter 1).");
});

test("E2E-64: with pictures on None, no picture request is ever sent", async ({ page }) => {
  await readyStory(page);
  const key = "sk-test-valid~none";
  await setUpPictures(page, "None", key);
  await writeBlock(page, "He walks to the sect gate at dawn.", 1);
  await expect(blocks(page).nth(0).locator("[data-picture]")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "End Chapter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End Chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: /has ended/ })).toBeVisible();
  expect((await lastImageRequest(page, key)).status()).toBe(404);
});
