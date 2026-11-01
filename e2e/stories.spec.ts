import { expect, test } from "@playwright/test";
import { createStory, openApp, openTab, panel, readyStory, saveSetting, startCharacter } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("E2E-04: create a story, find it after a reload, delete it", async ({ page }) => {
  await createStory(page, "The Azure Sword");
  await page.reload();
  await page.getByRole("button", { name: "Stories" }).click();
  const card = page.getByRole("button", { name: /^Open The Azure Sword/ });
  await expect(card).toBeVisible();

  await page.getByRole("button", { name: "More for The Azure Sword" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete story" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No stories yet" })).toBeVisible();
});

test("E2E-05: cultivation setting fields, saved setting reopens after a reload", async ({ page }) => {
  await createStory(page, "Mountain Sect");
  await openTab(page, "Setting");
  await expect(panel(page).getByText("World cruelty")).toBeVisible();
  await expect(panel(page).getByText("Era and place")).toHaveCount(0);

  await saveSetting(page, "Nine peaks float above a sea of clouds.");
  await page.reload();
  await page.getByRole("button", { name: "Stories" }).click();
  await page.getByRole("button", { name: /^Open Mountain Sect/ }).click();
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toHaveValue("Nine peaks float above a sea of clouds.");
});

test("E2E-06: a cultivation main character needs a special ability, and there is only one", async ({ page }) => {
  await createStory(page, "Lone Cultivator");
  await startCharacter(page, true);
  const form = panel(page);
  await form.getByLabel(/^Name/).fill("Lin Feng");
  // The form starts with an example special ability (decision 45); clear it to check the rule.
  await form.getByLabel(/^Special ability/).fill("");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByText("Some fields need attention.", { exact: false })).toBeVisible();
  await expect(form.getByLabel(/^Special ability/)).toHaveAttribute("aria-invalid", "true");

  await form.getByLabel(/^Special ability/).fill("Can see the flow of qi.");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByRole("button", { name: /Lin Feng.*Main character/ })).toBeVisible();
  await expect(form.getByRole("button", { name: "Create main character" })).toHaveCount(0);
});

test("E2E-07: a romance character under 18 cannot be saved (decision 16)", async ({ page }) => {
  await createStory(page, "Campus Days", "Romance");
  await startCharacter(page, false);
  const form = panel(page);
  await form.getByLabel(/^Name/).fill("Mei");
  await form.getByLabel(/^Age/).fill("17");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByText("Characters in this story type must be 18 or older.")).toBeVisible();

  await form.getByLabel(/^Age/).fill("18");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByRole("button", { name: /Mei/ })).toBeVisible();
});

test("E2E-08: the Novel tab unlocks once setting and main character exist (spec 4)", async ({ page }) => {
  await createStory(page, "Ready Story", "Romance");
  await expect(panel(page).locator(".checklist li.ok")).toHaveCount(0);

  await saveSetting(page);
  await openTab(page, "Novel");
  await expect(panel(page).locator(".checklist li.ok")).toHaveCount(1);
  await startCharacter(page, true);
  await panel(page).getByLabel(/^Name/).fill("Mei");
  await panel(page).getByLabel(/^Age/).fill("24");
  await panel(page).getByRole("button", { name: "Create character" }).click();
  await expect(panel(page).getByRole("button", { name: /Mei/ })).toBeVisible();

  await openTab(page, "Novel");
  await expect(panel(page).locator(".checklist")).toHaveCount(0);
  await expect(panel(page).getByRole("heading", { name: "Start chapter 1" })).toBeVisible();
});

test("E2E-14: a new story's setting saves with its defaults, no typing needed (decision 44)", async ({ page }) => {
  await createStory(page, "Quick Start", "Romance");
  await openTab(page, "Setting");
  // One of the type's curated sets, picked at random (decision 72).
  await expect(panel(page).getByLabel(/Background summary of the world/)).toHaveValue(/.{100,}/);
  await panel(page).getByRole("button", { name: "Save setting" }).click();
  await expect(panel(page).getByText("Setting saved.")).toBeVisible();

  await openTab(page, "Novel");
  await expect(panel(page).locator(".checklist li.ok")).toHaveCount(1);
});

test("E2E-15: the main character form starts filled in and saves without typing (decisions 45, 85)", async ({ page }) => {
  for (const [title, type] of [
    ["Quick Sect", "Cultivation"],
    ["Quick Cafe", "Romance"],
  ] as const) {
    await createStory(page, title, type);
    await startCharacter(page, true);
    // The main character of the story's random curated set.
    const name = await panel(page).getByLabel(/^Name/).inputValue();
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    await panel(page).getByRole("button", { name: "Create character" }).click();
    await expect(panel(page).getByRole("button", { name: new RegExp(`${name}.*Main character`) })).toBeVisible();

    // Other characters still start empty.
    await panel(page).getByRole("button", { name: "Add character" }).click();
    await expect(panel(page).getByLabel(/^Name/)).toHaveValue("");
  }
});

test("E2E-26: every label points at its own field while a character and the setting are open together", async ({
  page,
}) => {
  await readyStory(page);
  await openTab(page, "Characters");
  await panel(page).getByRole("button", { name: /Lin Feng/ }).click();
  await panel(page).getByLabel("Background summary", { exact: true }).fill("Raised by fishermen.");

  // The Setting tab stays mounted beside the character form; its label must still find its own box.
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toHaveValue(
    "A world of floating mountains and old sects.",
  );
  const ids = await page.locator("[id]").evaluateAll((els) => els.map((e) => e.id));
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
});
