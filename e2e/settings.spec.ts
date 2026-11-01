import { expect, test } from "@playwright/test";
import { closeGuide, openApp, saveKey, useMockAi } from "./helpers";

test("E2E-01: first launch opens Settings with the guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByText("Welcome. One step before you write:")).toBeVisible();
});

test.describe("E2E-02: API key and connection test (spec 9)", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await useMockAi(page);
  });

  test("a valid key lists the models", async ({ page }) => {
    await saveKey(page, "sk-test-valid");
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText("Connected. 4 models are available.")).toBeVisible();
    await expect(page.locator("#model-list option")).toHaveCount(4);
  });

  test("a wrong key is reported as rejected", async ({ page }) => {
    await saveKey(page, "sk-wrong");
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/The API key was rejected/)).toBeVisible();
  });

  test("a rate limit is explained", async ({ page }) => {
    await saveKey(page, "sk-test-rate-limit");
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/too many requests from this key. Wait a minute/)).toBeVisible();
  });

  test("an answer that is not JSON is explained", async ({ page }) => {
    await saveKey(page, "sk-test-bad-json");
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/not in the expected format/)).toBeVisible();
  });
});

test("E2E-03: theme and font size apply at once and survive a reload", async ({ page }) => {
  await openApp(page);
  await page.getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const slider = page.locator("#font-size");
  await slider.focus();
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(page.getByText("Reading font size: 19px")).toBeVisible();

  await page.reload();
  await closeGuide(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Reading font size: 19px")).toBeVisible();
});

test("E2E-34: the setup guide opens on first launch and from its button (spec 9, decisions 81, 82)", async ({ page }) => {
  const guide = page.getByRole("dialog", { name: "Set up your AI connection" });
  await page.goto("/");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("button", { name: "Get a key" })).toHaveCount(3);

  // A provider's button fills in its base URL.
  await guide.locator("li.provider", { hasText: "DeepSeek" }).getByRole("button", { name: "Use its base URL" }).click();
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue("https://api.deepseek.com/v1");

  // Once closed, a later visit to Settings does not open it again.
  await guide.getByRole("button", { name: "Got it" }).click();
  await expect(guide).toBeHidden();
  await page.getByRole("button", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: /^Settings/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(guide).toBeHidden();

  // The button opens it at any time; Escape closes it.
  await page.getByRole("button", { name: "Setup guide" }).click();
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
});
