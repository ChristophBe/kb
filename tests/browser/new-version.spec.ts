import { expect, test } from "@playwright/test";

// A document gets a new version from its page: it keeps its title and
// address, its version goes up and its passages come from the new file.
const run = Date.now().toString(36);
const filename = `glacier-${run}.md`;

test("a new version replaces the file and passages of a document", async ({ page }) => {
  await page.goto("/m/ingestion");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from("# Glaciers\n\nGlaciers form where snow piles up faster than it melts.\n"),
  });
  await expect(
    page.getByRole("listitem").filter({ hasText: filename }).getByText("Done"),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await page.getByRole("link", { name: filename }).click();
  const documentUrl = page.url();
  const version = page.locator("dt", { hasText: "Version" }).locator("..");
  await expect(version.locator("dd")).toHaveText(/^1\s*Upload new version$/);

  await version.getByRole("link", { name: "Upload new version" }).click();
  await expect(page.getByRole("heading", { name: "Upload new version" })).toBeVisible();
  const replacement = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file" }).click();
  await (await replacement).setFiles({
    name: `glacier-${run}-v2.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from("# Glaciers, revised\n\nMoraines are the rocks a glacier leaves behind.\n"),
  });

  // Back on the same document, which takes on the new version once processed.
  await expect(page).toHaveURL(documentUrl);
  await expect(version.locator("dd")).toHaveText(/^2\s*Upload new version$/, { timeout: 60_000 });
  const file = page.locator("dt", { hasText: "Filename" }).locator("..");
  await expect(file).toContainText(`glacier-${run}-v2.md`);
  await expect(page.getByRole("heading", { name: filename })).toBeVisible();
  await expect(page.getByRole("article").first()).toContainText("Moraines");
  await expect(page.getByText("snow piles up")).toHaveCount(0);
});
