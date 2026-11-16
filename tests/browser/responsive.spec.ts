import { expect, test } from "@playwright/test";

// The shell on a phone (320 px) and on a desktop (1280 px) (#61).
const pages = ["/m/chat", "/m/document", "/m/ingestion", "/m/iam/teams", "/m/llm"];

const noHorizontalScroll = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("at 320 px", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  for (const path of pages) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }

  test("the menu button opens the sidebar, Escape and navigation close it", async ({ page }) => {
    await page.goto("/m/document");
    const menu = page.getByRole("button", { name: "Open menu" });
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeHidden();

    await menu.click();
    await expect(nav).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await nav.getByRole("link", { name: "Upload", exact: true }).click();
    await expect(page).toHaveURL(/\/m\/ingestion$/);
    await expect(nav).toBeHidden();
  });

  test("the documents table scrolls inside its container", async ({ page }) => {
    await page.goto("/m/document");
    const table = page.getByRole("table", { name: "Documents" });
    // Documents exist when earlier specs ran; without any there is no table to check.
    test.skip((await table.count()) === 0, "no documents in this stack");
    const scroller = table.locator("xpath=..");
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("a conversation and the list are separate views", async ({ page }) => {
    await page.goto("/m/chat");
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/m\/chat\/[^/]+$/);
    await expect(page.getByRole("navigation", { name: "Conversations" })).toBeHidden();
    await page.getByRole("link", { name: "All conversations" }).click();
    await expect(page).toHaveURL(/\/m\/chat$/);
    await expect(page.getByRole("navigation", { name: "Conversations" })).toBeVisible();
  });
});

test.describe("at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the sidebar is always visible and has no menu button", async ({ page }) => {
    await page.goto("/m/document");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
  });

  test("the conversation list sits beside the conversation", async ({ page }) => {
    await page.goto("/m/chat");
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/m\/chat\/[^/]+$/);
    await expect(page.getByRole("navigation", { name: "Conversations" })).toBeVisible();
    await expect(page.getByRole("link", { name: "All conversations" })).toBeHidden();
  });
});
