/**
 * Phase 7, look and feel (spec 10, 12; decisions 94–112): the top bar and
 * About page, the bookshelf, the chapter side list, the art and its switch,
 * the fantasy story type and the book opening.
 */
import { expect, test } from "@playwright/test";
import {
  chapterText,
  createStory,
  openApp,
  openTab,
  panel,
  readyStory,
  setUpMockAi,
  startCharacter,
  waitForBlock,
} from "./helpers";

test("E2E-48: the top bar leads to About, which shows the version, the author and copies the email (spec 10)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openApp(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("button")).toHaveText(["Stories", "Settings", "About"]);
  await nav.getByRole("button", { name: "About" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
  await expect(page.getByText(/^\d+\.\d+\.\d+$/)).toBeVisible();
  await expect(page.getByText("JC Do Things")).toBeVisible();
  await expect(page.getByText("jc.do.things@gmail.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open the home page" })).toBeVisible();
  await expect(page.getByText(/Literata/)).toBeVisible();

  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("jc.do.things@gmail.com");
});

test("E2E-49: the bookshelf puts the last opened story first, with Delete in the book's menu (decisions 96, 109)", async ({ page }) => {
  await openApp(page);
  await createStory(page, "First Book");
  await createStory(page, "雲海仙途", "Cultivation");
  await createStory(page, "Third Book", "Romance");
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  const books = page.getByRole("list", { name: "Your stories" }).getByRole("button", { name: /^Open / });
  await expect(books).toHaveCount(3);
  await expect(books.first()).toHaveAccessibleName(/^Open Third Book \(Romance, English, 0 chapters\)/);

  // Opening a story moves it to the front.
  await page.getByRole("button", { name: /^Open First Book/ }).click();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await expect(books.first()).toHaveAccessibleName(/^Open First Book/);

  // A Chinese title runs vertically; the last place is the "New story" outline.
  await expect(page.getByRole("button", { name: /^Open 雲海仙途/ }).locator(".spine-title")).toHaveClass(/vertical/);
  await expect(page.getByRole("list", { name: "Your stories" }).getByRole("button", { name: "New story" })).toBeVisible();

  // Escape closes the menu and gives focus back to its button (QA-05).
  const more = page.getByRole("button", { name: "More for Third Book" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete story" }).click();
  await expect(books).toHaveCount(2);
});

test("E2E-50: a fantasy story is set up without typing, with a class Other must name (spec 7.6, 8.5, decisions 104, 105)", async ({ page }) => {
  await openApp(page);
  await setUpMockAi(page);
  await createStory(page, "The Wild Road", "Fantasy");
  await openTab(page, "Setting");
  await expect(panel(page).getByRole("heading", { name: "Fantasy world" })).toBeVisible();
  await expect(panel(page).getByLabel(/^Races of the world/)).not.toHaveValue("");
  await panel(page).getByRole("button", { name: "Save setting" }).click();
  await expect(panel(page).getByText("Setting saved.")).toBeVisible();

  await startCharacter(page, true);
  const form = panel(page);
  // The race comes from the setting's list, and the set's main character has one of its ranks.
  const race = form.getByLabel(/^Race/);
  await expect(race).not.toHaveValue("");
  expect(await race.locator("option").count()).toBeGreaterThan(2);
  await expect(form.getByLabel(/^Adventurer rank/)).not.toHaveValue("");

  // Other opens a box that must be filled; what is typed is the class.
  const cls = form.getByLabel(/^Class/);
  await cls.selectOption("Other");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByText("Class: type it in the box, or pick one from the list.")).toBeVisible();
  // Typed key by key: the box stays open when the text so far is a listed class ("Mage", CR-02).
  await form.getByLabel("Class: your own").pressSequentially("Mage hunter");
  await expect(form.getByLabel("Class: your own")).toHaveValue("Mage hunter");
  await form.getByRole("button", { name: "Create character" }).click();
  await expect(form.getByRole("button", { name: /Mage hunter/ })).toBeVisible();

  await openTab(page, "Novel");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await expect(chapterText(page)).toContainText("Mock block");
});

test("E2E-51: with no adventurer ranks in the setting, characters have no rank field, the main character included (decision 104)", async ({ page }) => {
  await openApp(page);
  await createStory(page, "No Ranks", "Fantasy");
  await openTab(page, "Setting");
  await panel(page).getByLabel(/^Adventurer ranks/).fill("");
  await panel(page).getByRole("button", { name: "Save setting" }).click();
  await expect(panel(page).getByText("Setting saved.")).toBeVisible();
  await startCharacter(page, false);
  await expect(panel(page).getByLabel(/^Race/)).toBeVisible();
  await expect(panel(page).getByLabel(/^Adventurer rank/)).toHaveCount(0);

  // The set's main character comes without its rank either (QA-03).
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await startCharacter(page, true);
  await expect(panel(page).getByLabel(/^Race/)).not.toHaveValue("");
  await expect(panel(page).getByLabel(/^Adventurer rank/)).toHaveCount(0);
});

test("E2E-52: the story's background and the character's figure show, and Background art turns them off (spec 12.3)", async ({ page }) => {
  await openApp(page);
  await createStory(page, "Art Check", "Romance");
  await expect(page.locator(".story-art img")).toHaveAttribute("src", /romance.*\.webp/);
  await startCharacter(page, false);
  const gender = panel(page).getByLabel(/^Gender/);
  await gender.selectOption("Female");
  await expect(page.locator(".character-figure")).toHaveAttribute("data-figure", "female");
  await gender.selectOption("Non-binary");
  await expect(page.locator(".character-figure")).toHaveAttribute("data-figure", "neutral");
  // The figure holds still while a field has focus (decision 111).
  await panel(page).getByLabel(/^Name/).focus();
  await expect(page.locator(".character-figure")).toHaveClass(/still/);
  await panel(page).getByLabel(/^Name/).blur();
  await expect(page.locator(".character-figure")).not.toHaveClass(/still/);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("group", { name: "Background art" }).getByText("Off", { exact: true }).click();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: /^Open Art Check/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Art Check" })).toBeVisible();
  await expect(page.locator(".story-art")).toHaveCount(0);
});

test("E2E-53: below 1100 pixels the chapter list folds into a Chapters button (spec 12.1, decision 100)", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await readyStory(page);
  const list = panel(page).getByRole("navigation", { name: "Chapters" });
  await expect(list).toBeHidden();
  await panel(page).getByRole("button", { name: "Chapters" }).click();
  await expect(list).toBeVisible();
  await expect(list.getByRole("button", { name: /Chapter 1/ })).toHaveAttribute("aria-current", "true");
  await list.getByRole("button", { name: "Close the chapter list" }).click();
  await expect(list).toBeHidden();
  // Escape closes it too, and focus goes back to the Chapters button (QA-04).
  const toggle = panel(page).getByRole("button", { name: "Chapters" });
  await toggle.click();
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(toggle).toBeFocused();
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("E2E-54: entering a story opens its book, and a click ends it at once (spec 12.4)", async ({ page }) => {
    await openApp(page);
    await createStory(page, "Opening");
    await page.getByRole("button", { name: "Stories", exact: true }).click();
    await page.getByRole("button", { name: /^Open Opening/ }).click();
    const book = page.locator(".book-opening");
    await expect(book).toBeVisible();
    await page.mouse.click(10, 300);
    await expect(book).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Opening" })).toBeVisible();
  });
});

test("E2E-55: with reduced motion the book does not open and nothing moves (spec 12.4)", async ({ page }) => {
  await openApp(page);
  await createStory(page, "Still");
  await expect(page.locator(".book-opening")).toHaveCount(0);
  const drift = await page.locator(".story-art img").evaluate((el) => getComputedStyle(el).animationName);
  expect(drift).toBe("none");
});
