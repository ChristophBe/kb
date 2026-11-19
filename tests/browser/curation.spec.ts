import { expect, type Page, test } from "@playwright/test";
import { users } from "./users.ts";

// The same text uploaded twice is reported as a duplicate. Unique per run, so
// the test also passes against a stack that already holds earlier runs' documents.
const run = Date.now().toString(36);
const original = `policy-${run}.md`;
const copy = `policy-${run}-copy.md`;
const body = `# Holiday policy ${run}

Employees get twenty-five days of paid holiday a year.
`;

async function upload(page: Page, filename: string) {
  await page.goto("/m/ingestion");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(body),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const job = page.getByRole("listitem").filter({ hasText: filename });
  await expect(job.getByText("Ready")).toBeVisible({ timeout: 60_000 });
}

test("a duplicate upload shows up in the document checks and can be closed", async ({ page }) => {
  await upload(page, original);
  await upload(page, copy);

  await page.getByRole("link", { name: "Document checks", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Document checks" })).toBeVisible();

  // The finding is made after the processing, so look again until it is there.
  const finding = page
    .getByRole("list", { name: "Findings" })
    .getByRole("listitem")
    .filter({ hasText: `Duplicate of ${original}` });
  await expect(async () => {
    await page.reload();
    await expect(finding).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  // Both documents are named as links to their pages.
  await expect(finding.getByRole("link", { name: copy })).toHaveAttribute(
    "href",
    /\/m\/document\/[^/]+$/,
  );
  await expect(finding.getByRole("link", { name: original })).toBeVisible();
  await expect(finding.getByText(/Relevance \d+ %/)).toBeVisible();

  // Replacing asks first; cancelling changes nothing.
  await finding.getByRole("button", { name: `Replace ${copy}` }).click();
  const dialog = page.getByRole("dialog", { name: `Replace ${copy}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(finding).toBeVisible();

  // Ignoring closes it at once, tells so, and leaves the focus on the page.
  await finding.getByRole("button", { name: `Ignore ${copy}` }).click();
  await expect(page.getByText("Finding ignored")).toBeVisible();
  await expect(finding).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Findings" })).toBeFocused();
});

test("the document checks fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/m/curation");
  await expect(page.getByRole("heading", { level: 1, name: "Document checks" })).toBeVisible();
  // Whether there are findings or not, nothing sticks out sideways.
  await expect(
    page.getByRole("list", { name: "Findings" }).or(page.getByText(/^No findings\./)),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the owner sets a document's approval state, others can only look at it", async ({
  page,
  browser,
}) => {
  const filename = `handbook-${run}.md`;
  const handbook = `# Handbook ${run}\n\nThe handbook explains how we work together.\n`;
  await page.goto("/m/ingestion");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(handbook),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: filename }).getByText("Ready"),
  ).toBeVisible({ timeout: 60_000 });

  await page.goto("/m/document");
  await page.getByRole("link", { name: filename }).click();
  const detailUrl = page.url();
  await expect(page.getByRole("heading", { name: filename })).toBeVisible();

  // Deprecating says what it does to chat, then needs its own button.
  await page.getByRole("button", { name: "Approval state" }).click();
  const dialog = page.getByRole("dialog", { name: "Approval state" });
  await dialog.getByRole("radio", { name: /Deprecated/ }).check();
  await expect(dialog.getByRole("note")).toContainText("Chat stops using this document");
  await dialog.getByLabel(/Note/).fill("Replaced by the new handbook");
  await dialog.getByRole("button", { name: "Deprecate document" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Approval state: Deprecated")).toBeVisible();
  // The focus is back on the button that opened the dialog.
  await expect(page.getByRole("button", { name: "Approval state" })).toBeFocused();

  // The page shows the badge and the history with who, when and why.
  const toolbar = page.getByRole("toolbar", { name: "Document actions" });
  await expect(toolbar.getByText("Deprecated")).toBeVisible();
  const history = page.getByRole("region", { name: "Approval history" });
  await expect(history).toContainText("by you");
  await expect(history).toContainText("Replaced by the new handbook");

  // The documents list shows it too.
  await page.goto("/m/document");
  const row = page.getByRole("row").filter({ hasText: filename });
  await expect(row.getByText("Deprecated")).toBeVisible();

  // Someone who may not change the state can read it, but not change it.
  const bobContext = await browser.newContext({ storageState: users.bob.storageState });
  const bob = await bobContext.newPage();
  await bob.goto(detailUrl);
  await expect(bob.getByRole("button", { name: "Approval state" })).toBeDisabled();
  await expect(
    bob.getByRole("toolbar", { name: "Document actions" }).getByText("Deprecated"),
  ).toBeVisible();
  await bobContext.close();
});

test("a reported document shows up for its owner, who can dismiss the reports", async ({
  page,
  browser,
}) => {
  const filename = `report-${run}.md`;
  await page.goto("/m/ingestion");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# Report ${run}\n\nThe prices on this page are from last year.\n`),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: filename }).getByText("Ready"),
  ).toBeVisible({ timeout: 60_000 });
  await page.goto("/m/document");
  await page.getByRole("link", { name: filename }).click();
  const detailUrl = page.url();

  // Bob reads it and reports it; the dialog says what happens next.
  const bobContext = await browser.newContext({ storageState: users.bob.storageState });
  const bob = await bobContext.newPage();
  await bob.goto(detailUrl);
  await bob.getByRole("button", { name: "Report", exact: true }).click();
  const dialog = bob.getByRole("dialog", { name: "Report this document" });
  await expect(dialog).toContainText("ranks a little lower until they have looked at it");
  await dialog.getByRole("radio", { name: /Outdated/ }).check();
  await dialog.getByLabel(/Comment/).fill("Prices are from last year");
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(bob.getByText("Report sent")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Reported" })).toBeFocused();

  // Having reported, he sees his report, not a second form.
  await bob.getByRole("button", { name: "Reported" }).click();
  const mine = bob.getByRole("dialog", { name: "You reported this document" });
  await expect(mine).toContainText("Outdated");
  await expect(mine.getByRole("radio")).toHaveCount(0);
  await mine.getByRole("button", { name: "Close" }).click();

  // The owner sees the report on Document checks, with its reason and comment.
  await page.getByRole("link", { name: "Document checks", exact: true }).click();
  const finding = page
    .getByRole("list", { name: "Findings" })
    .getByRole("listitem")
    .filter({ hasText: "Reported by one person" })
    .filter({ hasText: filename });
  await expect(finding).toBeVisible();
  await expect(finding.getByRole("list", { name: "Reports" })).toContainText("Outdated");
  await expect(finding.getByRole("list", { name: "Reports" })).toContainText(
    "Prices are from last year",
  );

  // Bob sees only his own report there, and can't close it.
  await bob.getByRole("link", { name: "Document checks", exact: true }).click();
  const bobsFinding = bob
    .getByRole("list", { name: "Findings" })
    .getByRole("listitem")
    .filter({ hasText: `You reported ${filename}` });
  await expect(bobsFinding).toBeVisible();
  await expect(bobsFinding.getByRole("button")).toHaveCount(0);

  // The owner dismisses the reports: they leave the list and the document ranks as before.
  await finding.getByRole("button", { name: `Dismiss reports ${filename}` }).click();
  await expect(page.getByText("Reports dismissed")).toBeVisible();
  await expect(finding).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Findings" })).toBeFocused();
  await bob.goto(detailUrl);
  await expect(bob.getByRole("button", { name: "Report", exact: true })).toBeVisible();
  await bobContext.close();
});
