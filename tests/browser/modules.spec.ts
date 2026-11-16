import { expect, type Page, test } from "@playwright/test";

/** Serves the shell's runtime config with only `enabled` modules (`enabledModules`). */
async function enableOnly(page: Page, enabled: string[]) {
  await page.route("/config.json", async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, enabledModules: enabled } });
  });
}

test("a module disabled in the runtime config is gone from nav and search", async ({ page }) => {
  const chatLink = page.getByRole("link", { name: "Chat", exact: true });
  const conversations = page.getByRole("heading", { name: /^Conversations/ });

  // With every module, the app opens on Chat: the checks below would notice it.
  await page.goto("/");
  await expect(page).toHaveURL(/\/m\/chat$/);
  await expect(chatLink).toBeVisible();
  await page.goto("/search?q=chat");
  await expect(conversations).toBeVisible();

  // Without Chat, the app opens on the next module.
  await enableOnly(page, ["document", "ingestion", "llm"]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/m\/document$/);
  await expect(page.getByRole("link", { name: "Documents", exact: true })).toBeVisible();
  await expect(chatLink).toHaveCount(0);

  await page.goto("/search?q=chat");
  await expect(page.getByRole("heading", { name: /^Documents/ })).toBeVisible();
  await expect(conversations).toHaveCount(0);

  await page.goto("/m/chat");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
