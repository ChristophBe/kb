import { expect, type Page, test } from "@playwright/test";

/** Serves the shell's runtime config with only `enabled` modules (`enabledModules`). */
async function enableOnly(page: Page, enabled: string[]) {
  await page.route("/config.json", async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, enabledModules: enabled } });
  });
}

test("a module disabled in the runtime config is gone from nav, home and search", async ({
  page,
}) => {
  const chatLink = page.getByRole("link", { name: "Chat", exact: true });
  const prompt = page.getByLabel("Ask a question");
  const conversations = page.getByRole("heading", { name: /^Conversations/ });

  // With every module, Chat is there: the checks below would notice it.
  await page.goto("/");
  await expect(chatLink).toBeVisible();
  await expect(prompt).toBeVisible();
  await page.goto("/search?q=chat");
  await expect(conversations).toBeVisible();

  await enableOnly(page, ["document", "ingestion", "llm"]);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Documents", exact: true })).toBeVisible();
  await expect(chatLink).toHaveCount(0);
  await expect(prompt).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ask, get cited answers" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Search by meaning" })).toBeVisible();

  await page.goto("/search?q=chat");
  await expect(page.getByRole("heading", { name: /^Documents/ })).toBeVisible();
  await expect(conversations).toHaveCount(0);

  await page.goto("/m/chat");
  await expect(page.getByText("Page not found.")).toBeVisible();
});
