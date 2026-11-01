/**
 * Phase 6: UI languages, curated sets and Randomize, tokens, action notes,
 * chapter links and visible progress (docs/testing.md section 5, phase 6
 * acceptance checks). The mock AI reports 1,200 input and 300 output tokens
 * per call, except for sk-test-no-usage (scripts/mock-ai-server.mjs).
 */
import { expect, Page, test } from "@playwright/test";
import {
  blocks,
  chapterText,
  createStory,
  MOCK_AI,
  openApp,
  openTab,
  panel,
  readyStory,
  setUpMockAi,
  startCharacter,
  switchKey,
  waitForBlock,
} from "./helpers";

async function endChapter(page: Page) {
  await panel(page).getByRole("button", { name: "End Chapter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End Chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: /has ended/ })).toBeVisible();
}

/** Rejects every proposal and finishes the chapter. */
async function finishChapter(page: Page) {
  const reject = panel(page).getByRole("button", { name: "Reject" });
  // Each answer re-renders the list, so click the first one left until none is.
  while ((await reject.count()) > 0) {
    const left = await reject.count();
    await reject.first().click();
    await expect(reject).toHaveCount(left - 1);
  }
  await panel(page).getByRole("button", { name: "Finish chapter" }).click();
}

async function setUiLanguage(page: Page, settingsLabel: string, language: string) {
  await page.getByRole("button", { name: settingsLabel, exact: true }).click();
  await page.locator("#ui-language").selectOption({ label: language });
}

const CJK = /[一-鿿]/;

test("E2E-35: switching the UI language changes the whole UI, and never a story's language (spec 11)", async ({ page }) => {
  await openApp(page);
  await setUpMockAi(page, "sk-test-rate-limit");
  await setUiLanguage(page, "Settings", "繁體中文");

  // Settings, in place: labels, buttons and an error from src/lib.
  await expect(page.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主選單" }).getByRole("button", { name: "故事" })).toBeVisible();
  await page.getByRole("button", { name: "測試連線" }).click();
  await expect(page.getByText(/這把金鑰送出的請求太多了/)).toBeVisible();
  await page.getByRole("button", { name: "設定指南" }).click();
  await expect(page.getByRole("dialog", { name: "設定 AI 連線" })).toBeVisible();
  await page.getByRole("button", { name: "知道了" }).click();

  // A new story starts in the UI language, with its world and main character in it (decision 71).
  await page.getByRole("button", { name: "故事", exact: true }).click();
  await page.getByRole("button", { name: "新故事" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新故事" });
  await dialog.getByLabel("標題").fill("雲海");
  await expect(dialog.getByLabel("小說語言")).toHaveValue("繁體中文 (Traditional Chinese)");
  await dialog.getByText("修仙", { exact: true }).click();
  await dialog.getByRole("button", { name: "建立故事" }).click();
  await expect(page.getByRole("tab", { name: "世界設定" })).toBeVisible();
  await page.getByRole("tab", { name: "世界設定" }).click();
  await expect(panel(page).getByLabel(/世界背景簡介/)).toHaveValue(CJK);
  await expect(panel(page).getByRole("heading", { name: "修仙世界" })).toBeVisible();
  await expect(panel(page).getByText("熱血").or(panel(page).getByText("黑暗")).or(panel(page).getByText("幽默")).first()).toBeVisible();
  await page.getByRole("tab", { name: "角色" }).click();
  await panel(page).getByRole("button", { name: "建立主角" }).click();
  await expect(panel(page).getByLabel(/^姓名/)).toHaveValue(CJK);
  await expect(panel(page).getByRole("button", { name: "隨機起名" })).toBeVisible();

  // Back to English: the story keeps its language.
  await setUiLanguage(page, "設定", "English");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open 雲海/ })).toHaveAccessibleName(/繁體中文/);
  await expect(page.getByRole("button", { name: /^Open 雲海/ })).toHaveAccessibleName(/Cultivation/);
});

test("E2E-36: a Chinese story sends its setting, characters and choices in Chinese, keys in English (spec 6.5)", async ({
  page,
  request,
}) => {
  const key = `sk-test-valid~${test.info().testId}`;
  await openApp(page);
  await setUpMockAi(page, key);
  await setUiLanguage(page, "Settings", "简体中文");
  await page.getByRole("button", { name: "故事", exact: true }).click();
  await page.getByRole("button", { name: "新故事" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新故事" });
  await dialog.getByLabel("标题").fill("长安");
  await dialog.getByText("言情", { exact: true }).click();
  await dialog.getByRole("button", { name: "创建故事" }).click();
  await page.getByRole("tab", { name: "世界设定" }).click();
  await panel(page).getByRole("button", { name: "保存世界设定" }).click();
  await expect(panel(page).getByText("世界设定已保存。")).toBeVisible();
  await page.getByRole("tab", { name: "角色" }).click();
  await panel(page).getByRole("button", { name: "创建主角" }).click();
  await panel(page).getByRole("button", { name: "创建角色" }).click();
  await page.getByRole("tab", { name: "小说" }).click();
  await panel(page).getByRole("button", { name: "开始第 1 章" }).click();
  await expect(panel(page).getByText("1 段")).toBeVisible();

  const sent = await request.get(`${MOCK_AI}/_last-request`, { headers: { Authorization: `Bearer ${key}` } });
  const user = ((await sent.json()) as { messages: { content: string }[] }).messages[1].content;
  expect(user).toMatch(/era_and_place: (现代都市|校园|职场|古代)/);
  expect(user).toMatch(/trope: (慢热|欢喜冤家|假戏真做|破镜重圆)/);
  expect(user).toMatch(/gender: [男女]/);
  expect(user).toContain("status: 在世");
  expect(user).not.toMatch(/status: Alive|gender: (Male|Female)/);
});

test("E2E-37: Randomize fills another world each time; a new language swaps the untouched text (spec 8)", async ({ page }) => {
  await openApp(page);
  await createStory(page, "Many Worlds");
  await openTab(page, "Setting");
  const background = panel(page).getByLabel(/Background summary of the world/);
  const sects = panel(page).getByLabel(/Major sects and factions/);
  let previous = await background.inputValue();
  for (let i = 0; i < 10; i++) {
    await panel(page).getByRole("button", { name: "Randomize" }).click();
    await expect(background).not.toHaveValue(previous);
    previous = await background.inputValue();
  }
  // Fields outside the set keep the user's choice.
  await expect(panel(page).getByText("Unsaved changes")).toBeVisible();

  await sects.fill("My own sect: it guards my own pass.");
  await panel(page).getByLabel("Language of the novel").selectOption("简体中文 (Simplified Chinese)");
  await expect(background).toHaveValue(CJK);
  await expect(sects).toHaveValue("My own sect: it guards my own pass.");
  await panel(page).getByRole("button", { name: "Save setting" }).click();
  await expect(panel(page).getByText("Setting saved.")).toBeVisible();
});

test("E2E-38: Random name gives an unused name, and the main character form can take the setting's again (spec 7.1)", async ({
  page,
}) => {
  await openApp(page);
  await createStory(page, "Names", "Romance");
  await startCharacter(page, true);
  const name = panel(page).getByLabel(/^Name/);
  const example = await name.inputValue();
  await panel(page).getByRole("button", { name: "Random name" }).click();
  await expect(name).not.toHaveValue(example);
  await expect(name).not.toHaveValue("");
  await panel(page).getByRole("button", { name: "Use the setting's main character" }).click();
  await expect(name).toHaveValue(example);
});

test("E2E-39: tokens per block and chapter match the provider's report, and are marked when estimated (spec 6.6)", async ({
  page,
}) => {
  await readyStory(page);
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  const bar = panel(page).getByRole("region", { name: "Chapter progress" });
  await expect(bar).toContainText("This chapter: 1,200 in · 300 out tokens");
  await expect(blocks(page).first()).toContainText("1,200 in · 300 out tokens");

  await panel(page).getByRole("group", { name: "Suggested next actions" }).getByRole("button").first().click();
  await waitForBlock(page, 2);
  await panel(page).getByRole("button", { name: "Regenerate block" }).click();
  await expect(panel(page).getByText("Version 2 of 2")).toBeVisible();
  await expect(bar).toContainText("This chapter: 3,600 in · 900 out tokens");

  // Two blocks, one regenerated version and the End Chapter call.
  await endChapter(page);
  await expect(panel(page).getByText("Tokens used: 4,800 in · 1,200 out tokens")).toBeVisible();
  await finishChapter(page);
  await panel(page).getByRole("navigation", { name: "Chapters" }).getByRole("button").first().click();
  await expect(panel(page).getByText("Tokens used: 4,800 in · 1,200 out tokens")).toBeVisible();
  await panel(page).getByRole("button", { name: "Back to the current chapter" }).click();

  await switchKey(page, "sk-test-no-usage");
  await panel(page).getByRole("button", { name: "Start chapter 2" }).click();
  await waitForBlock(page, 1);
  await expect(bar).toContainText(/This chapter: ≈ [\d,]+ in · [\d,]+ out tokens \(estimated\)/);
});

test("E2E-40: each suggested action shows a note, and picking it sends the action alone (spec 6.3)", async ({ page }) => {
  await readyStory(page);
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  const suggestions = panel(page).getByRole("group", { name: "Suggested next actions" });
  await expect(suggestions.getByRole("button").first()).toContainText("A new ally, or a trap");
  await expect(suggestions.getByRole("button").nth(1)).toContainText("Safety, but the trail goes cold");
  await expect(suggestions.getByRole("button").nth(2)).toHaveText("Rest by the stones and wait");

  await suggestions.getByRole("button").first().click();
  await waitForBlock(page, 2);
  await expect(blocks(page).nth(1)).toContainText("Direction followed: Follow the stranger into the forest");
  await expect(blocks(page).nth(1)).not.toContainText("A new ally");
});

test("E2E-41: the chapter reader links to the previous and next chapter (spec 5.6)", async ({ page }) => {
  await readyStory(page);
  for (const n of [1, 2]) {
    await panel(page).getByRole("button", { name: `Start chapter ${n}` }).click();
    await waitForBlock(page, 1);
    await endChapter(page);
    await finishChapter(page);
  }
  await panel(page).getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: "1. Mock chapter 1" }).click();
  const links = panel(page).getByRole("navigation", { name: "Chapter navigation" }).first();
  await expect(links.getByRole("button")).toHaveText(["2. Mock chapter 2"]);
  await links.getByRole("button", { name: "2. Mock chapter 2" }).click();
  await expect(panel(page).getByRole("heading", { name: "Mock chapter 2" })).toBeVisible();
  await expect(links.getByRole("button")).toHaveText(["1. Mock chapter 1", "Current chapter"]);
  await links.getByRole("button", { name: "1. Mock chapter 1" }).click();
  await expect(panel(page).getByRole("heading", { name: "Mock chapter 1" })).toBeVisible();
  // The bottom links work too.
  await panel(page).getByRole("navigation", { name: "Chapter navigation" }).last().getByRole("button").click();
  await panel(page).getByRole("navigation", { name: "Chapter navigation" }).last().getByRole("button", { name: "Current chapter" }).click();
  await expect(panel(page).getByRole("heading", { name: "Start chapter 3" })).toBeVisible();
});

test("E2E-42: while a block is written, Writing… and Stop sit in the bottom action bar (decision 88)", async ({ page }) => {
  await readyStory(page, "sk-test-stream-slow");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  const bar = panel(page).getByRole("region", { name: "Chapter progress" });
  await expect(bar.getByRole("status")).toHaveText("Writing…");
  await expect(bar).toBeInViewport();
  await bar.getByRole("button", { name: "Stop" }).click();
  await expect(panel(page).getByText("Stopped. The unfinished block was discarded")).toBeVisible();
  await expect(bar.getByRole("status")).toHaveCount(0);
});

test("E2E-43: a story created earlier in Japanese still opens and writes blocks (decision 71)", async ({ page, request }) => {
  const key = `sk-test-valid~${test.info().testId}`;
  await readyStory(page, key);
  // Stories from before phase 6 could be in Japanese; make this one so, on disk.
  await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.endsWith("/story.json") || k.endsWith("/setting.md")) {
        localStorage.setItem(k, localStorage.getItem(k)!.replace(/English/g, "日本語 (Japanese)"));
      }
    }
  });
  await page.reload();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel("Language of the novel")).toHaveValue("日本語 (Japanese)");
  await openTab(page, "Novel");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await expect(chapterText(page)).toContainText("Mock block");

  const sent = await request.get(`${MOCK_AI}/_last-request`, { headers: { Authorization: `Bearer ${key}` } });
  const [system, user] = ((await sent.json()) as { messages: { content: string }[] }).messages.map((m) => m.content);
  expect(system).toContain("write the story and the suggested actions in 日本語 (Japanese)");
  expect(system).toContain("## Writing in 日本語 (Japanese)");
  expect(user).toMatch(/gender: (Male|Female)/);
});

test("E2E-44: once the story has started, the novel's language is fixed and Randomize is gone (decision 89)", async ({ page }) => {
  await readyStory(page);
  // Before the first block: both still work.
  await openTab(page, "Setting");
  await expect(panel(page).getByRole("button", { name: "Randomize" })).toBeVisible();
  await expect(panel(page).getByLabel("Language of the novel")).toBeEnabled();

  await openTab(page, "Novel");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await endChapter(page);
  await finishChapter(page);

  // Between chapters the setting is editable again, except the language.
  await openTab(page, "Setting");
  await expect(panel(page).getByLabel(/Background summary of the world/)).toBeEnabled();
  await expect(panel(page).getByLabel("Language of the novel")).toBeDisabled();
  await expect(panel(page).getByText("The novel's language is fixed once the story has started.")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Randomize" })).toHaveCount(0);
});

test("E2E-45: dialogs take focus, keep Tab inside, and give focus back when closed (CR6-06)", async ({ page }) => {
  await openApp(page);
  await createStory(page, "Focus");
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  // Delete is in the book menu (decision 96); focus comes back to the menu button.
  const remove = page.getByRole("button", { name: "More for Focus" });
  await remove.click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this story?" });
  const inside = () => dialog.evaluate((d) => d.contains(document.activeElement));
  expect(await inside()).toBe(true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await inside()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
});

test("E2E-46: a block written in the new chapter is still there after reading an earlier chapter (bug 2026-10-22)", async ({
  page,
}) => {
  await readyStory(page);
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await endChapter(page);
  await finishChapter(page);
  await panel(page).getByRole("button", { name: "Start chapter 2" }).click();
  await waitForBlock(page, 1);
  const first = await blocks(page).first().locator("p:not(.block-tokens)").first().textContent();

  // Read chapter 1, then come back by the reader's link.
  await panel(page).getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: "1. Mock chapter 1" }).click();
  await panel(page).getByRole("navigation", { name: "Chapter navigation" }).first().getByRole("button", { name: "Current chapter" }).click();
  await expect(panel(page).getByText("1 block")).toBeVisible();
  await expect(blocks(page).first()).toContainText(first ?? "");

  // The next block goes after it, and both survive a reload.
  await panel(page).getByRole("group", { name: "Suggested next actions" }).getByRole("button").first().click();
  await waitForBlock(page, 2);
  await page.reload();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: /^Open Azure Peaks/ }).click();
  await expect(panel(page).getByText("2 blocks")).toBeVisible();
});

test("E2E-47: a marker glued to the last story line still gives the suggestions, never shown as text (decision 90)", async ({ page }) => {
  await readyStory(page, "sk-test-stream-inline-marker");
  await panel(page).getByRole("button", { name: "Start chapter 1" }).click();
  await waitForBlock(page, 1);
  await expect(chapterText(page)).not.toContainText("NEXT");
  await expect(chapterText(page)).not.toContainText("Follow the stranger");
  const suggestions = panel(page).getByRole("group", { name: "Suggested next actions" }).getByRole("button");
  await expect(suggestions).toHaveCount(2);
  await expect(suggestions.first()).toContainText("A new ally, or a trap");
});
