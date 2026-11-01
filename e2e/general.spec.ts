/**
 * Phase 7b, the General story type (spec 4, 5.1, 7.7, 8.6; decisions 125–128):
 * the user writes the world, and every block starts from the user's direction.
 */
import { expect, Page, test } from "@playwright/test";
import { chapterText, createStory, openApp, openTab, panel, setUpMockAi, startCharacter, waitForBlock } from "./helpers";

const proposal = (page: Page, text: RegExp) => panel(page).getByRole("listitem").filter({ hasText: text });

test("E2E-56: a General story needs its world and a direction for every block, and shows no suggestions or openings (decisions 125, 126, 128)", async ({
  page,
}) => {
  await openApp(page);
  await setUpMockAi(page);
  await createStory(page, "Tea and Clues", "General");

  // The setting starts empty, without Randomize, and the genre and the world must be filled.
  await openTab(page, "Setting");
  const setting = panel(page);
  await expect(setting.getByRole("heading", { name: "About your world" })).toBeVisible();
  await expect(setting.getByRole("button", { name: "Randomize" })).toHaveCount(0);
  await expect(setting.getByLabel(/^Genre and style/)).toHaveValue("");
  await setting.getByRole("button", { name: "Save setting" }).click();
  await expect(setting.getByText("Genre and style is required.")).toBeVisible();
  await expect(setting.getByText("Describe the world in a few sentences.")).toBeVisible();
  await setting.getByLabel(/^Genre and style/).fill("Cozy mystery in 1920s London, light and witty.");
  await setting.getByLabel(/Background summary of the world/).fill("London, 1923. Evelyn runs a tea shop and solves small mysteries.");
  await setting.getByLabel(/^Rules of this world/).fill("No magic.");
  await setting.getByRole("button", { name: "Save setting" }).click();
  await expect(setting.getByText("Setting saved.")).toBeVisible();

  // The main character starts empty, with no Random name, and needs only a name.
  await startCharacter(page, true);
  const form = panel(page);
  await expect(form.getByLabel(/^Name/)).toHaveValue("");
  await expect(form.getByRole("button", { name: "Random name" })).toHaveCount(0);
  await expect(form.getByLabel(/^Abilities and notes/)).toBeVisible();
  await form.getByLabel(/^Name/).fill("Evelyn");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByRole("button", { name: /Evelyn.*Main character/ })).toBeVisible();

  // The first block needs a direction.
  await openTab(page, "Novel");
  const start = panel(page).getByRole("button", { name: "Start chapter 1" });
  await expect(start).toBeDisabled();
  await panel(page).getByLabel("Direction for the first block").fill("Evelyn finds a second teacup on the table, still warm.");
  await start.click();
  await waitForBlock(page, 1);
  await expect(chapterText(page)).toContainText("Direction followed: Evelyn finds a second teacup");

  // No suggestions under the block, and the next one needs a direction too.
  await expect(panel(page).getByRole("group", { name: "Suggested next actions" })).toHaveCount(0);
  await expect(panel(page).getByText("No suggestions came with this block.")).toHaveCount(0);
  const next = panel(page).getByRole("button", { name: "Write next block" });
  await expect(next).toBeDisabled();
  await panel(page).getByLabel("Your direction for the next block").fill("She asks the neighbour who came in.");
  await next.click();
  await waitForBlock(page, 2);

  // Chapter 2 opens with no openings to pick from.
  await panel(page).getByRole("button", { name: "End Chapter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End Chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: /has ended/ })).toBeVisible();
  for (const text of [/Evelyn · Condition/, /New character: Elder Wu/]) {
    await proposal(page, text).getByRole("button", { name: "Reject" }).click();
  }
  await panel(page).getByRole("button", { name: "Finish chapter" }).click();
  await expect(panel(page).getByRole("button", { name: "Start chapter 2" })).toBeDisabled();
  await expect(panel(page).getByRole("group", { name: "Chapter openings" })).toHaveCount(0);
});
