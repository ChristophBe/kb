import { expect, type Page, test } from "@playwright/test";

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
