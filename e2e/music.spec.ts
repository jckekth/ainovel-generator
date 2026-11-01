/**
 * Phase 8: background music (spec 13, decisions 130–135). The mock AI gives a
 * block the mood its direction names ("a battle at the gate"), otherwise none.
 * The player mirrors its state on <html data-music>: "<mood> playing",
 * "<mood> paused" or "" for silence.
 */
import { expect, Page, test } from "@playwright/test";
import { openApp, openTab, panel, readyStory, waitForBlock } from "./helpers";

const musicState = (page: Page) => page.locator("html");

async function writeBlock(page: Page, direction: string, count: number) {
  await panel(page).getByLabel(count === 1 ? /Direction for the first block/ : "Your direction for the next block").fill(direction);
  await panel(page).getByRole("button", { name: count === 1 ? "Start chapter 1" : "Write next block" }).click();
  await waitForBlock(page, count);
}

test("E2E-57: music comes in only at a peak, plays on, pauses when the story is left and resumes on return", async ({ page }) => {
  await readyStory(page);

  // Most blocks are silent (decision 130).
  await writeBlock(page, "He walks to the sect gate at dawn.", 1);
  await expect(musicState(page)).not.toHaveAttribute("data-music", /playing/);

  await writeBlock(page, "A battle at the gate.", 2);
  await expect(musicState(page)).toHaveAttribute("data-music", "battle playing");

  // A block with no mood lets the track play on (spec 13.2).
  await writeBlock(page, "He catches his breath.", 3);
  await expect(musicState(page)).toHaveAttribute("data-music", "battle playing");

  // Other tabs of the same story keep it playing; leaving the story pauses it (decision 132).
  await openTab(page, "Characters");
  await expect(musicState(page)).toHaveAttribute("data-music", "battle playing");
  await page.getByRole("button", { name: "About" }).click();
  await expect(musicState(page)).toHaveAttribute("data-music", "battle paused");
  await page.getByRole("button", { name: "Stories" }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await expect(musicState(page)).toHaveAttribute("data-music", "battle playing");

  // A new peak takes over from the battle.
  await openTab(page, "Novel");
  await writeBlock(page, "A sad farewell.", 4);
  await expect(musicState(page)).toHaveAttribute("data-music", "sad playing");
});

test("E2E-58: turning music off stops it at once, and nothing plays while it is off; the volume is saved", async ({ page }) => {
  await readyStory(page);
  await writeBlock(page, "A battle at the gate.", 1);
  await expect(musicState(page)).toHaveAttribute("data-music", "battle playing");

  await page.getByRole("button", { name: "Settings" }).click();
  const sound = page.locator("section", { has: page.getByRole("heading", { name: "Sound" }) });
  const musicSwitch = (label: "On" | "Off") => sound.getByRole("group", { name: "Music" }).getByText(label, { exact: true });
  await musicSwitch("Off").click();
  await expect(musicState(page)).toHaveAttribute("data-music", "");
  await expect(sound.getByLabel(/Music volume/)).toBeDisabled();

  await page.getByRole("button", { name: "Stories" }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await openTab(page, "Novel");
  await writeBlock(page, "Another battle on the bridge.", 2);
  await expect(musicState(page)).toHaveAttribute("data-music", "");

  await page.getByRole("button", { name: "Settings" }).click();
  await musicSwitch("On").click();
  await sound.getByLabel(/Music volume/).fill("30");
  await expect(sound.getByText("Music volume: 30%")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(sound.getByText("Music volume: 30%")).toBeVisible();
});

test("E2E-59: the About page credits every music track under CC BY 4.0 (decision 134)", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "About" }).click();
  for (const title of ["Satiate", "Death and Axes", "I Can Feel it Coming", "Lost Time", "Rainbows", "Touching Moments Four - Melody"]) {
    await expect(page.getByText(`"${title}" Kevin MacLeod (incompetech.com)`)).toContainText("Creative Commons: By Attribution 4.0 License");
  }
});
