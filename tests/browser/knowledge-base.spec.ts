import { expect, test } from "@playwright/test";
import { users } from "./users.ts";

// One document goes through the whole flow: upload, processing, a chat answer
// citing it, and another user who must not see it. Unique per run, so the
// tests also pass against a stack that already holds earlier runs' documents.
const run = Date.now().toString(36);
const filename = `aurora-${run}.md`;
// The shell uploads without a title; the document is named after the file.
const title = filename;
const body = `# Aurora

The aurora borealis appears when charged particles from the sun hit the upper atmosphere.
`;

test.describe.configure({ mode: "serial" });

// Set once the chat test has opened the document.
let documentPath = "";

test("an uploaded document becomes ready", async ({ page }) => {
  await page.goto("/m/ingestion");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(body),
  });
  const job = page.getByRole("listitem").filter({ hasText: filename });
  await expect(job.getByText("Done")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "Documents", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row.getByText("Ready")).toBeVisible();
});

test("a chat answer cites the document and opens the passage", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ask a question").fill("When does the aurora borealis appear?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const sources = page.getByRole("list", { name: "Sources" });
  await sources.getByRole("link", { name: `${title}, chunk 1` }).click();
  await expect(page).toHaveURL(/\/m\/document\/[^/#]+#chunk-0$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const chunk = page.getByRole("heading", { name: "Chunk 1", exact: true });
  await expect(chunk).toBeFocused();
  await expect(page.getByRole("article").filter({ has: chunk })).toContainText("charged particles");
  documentPath = new URL(page.url()).pathname;
});

test("another user does not see the document", async ({ browser }) => {
  test.skip(!documentPath, "needs the document of the previous tests");
  const context = await browser.newContext({ storageState: users.bob.storageState });
  const page = await context.newPage();

  await page.goto("/m/document");
  await expect(page.getByText(users.bob.email)).toBeVisible();
  // Wait for the list to load before checking what is missing from it.
  await expect(
    page.getByRole("table", { name: "Documents" }).or(page.getByText("No documents yet")),
  ).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);

  // Not even the link: the document service answers NOT_FOUND.
  await page.goto(documentPath);
  await expect(page.getByRole("alert").filter({ hasText: /not found/i })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
  await context.close();
});
