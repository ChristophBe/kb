import { expect, test } from "@playwright/test";
import { users } from "./users.ts";

// A document is uploaded to a team, then made public and back to the team from
// its page, and a member of the team sees its access change (#269, #286). Unique per run,
// so the test also passes against a stack that already holds earlier runs'
// documents and teams.
const run = Date.now().toString(36);
const team = `Sharing ${run}`;
const filename = `shared-${run}.md`;

// The document module learns a user's new teams within about half a minute, and
// a member's list within the same time, so the steps that depend on them retry.
const LEARNING_TIME = 90_000;

test("a document is shared with a team, and its member sees it", async ({ page, browser }) => {
  test.setTimeout(5 * 60_000);

  // bob has to have opened the app before alice can add him by email.
  const bobContext = await browser.newContext({ storageState: users.bob.storageState });
  const bob = await bobContext.newPage();
  const registered = bob.waitForResponse((r) => r.url().includes("IamService/GetCurrentUser"));
  await bob.goto("/m/iam/teams");
  await registered;

  await page.goto("/m/iam/teams");
  await page.getByLabel("New team").fill(team);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: team })).toBeVisible();
  await page.getByLabel("Add a member by email").fill(users.bob.email);
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByRole("row", { name: new RegExp(users.bob.email) })).toBeVisible();

  // Upload to the team. A team created a moment ago may not be known to the
  // document module yet: the row then says so and offers "Retry upload".
  await page.goto("/m/ingestion");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from("# Sharing\n\nThe team shares this note.\n"),
  });
  // The upload starts only once the access is confirmed.
  const access = page.getByRole("group", { name: "Who can read this?" });
  await expect(access.getByRole("radio", { name: /Public/ })).toBeChecked();
  await access.getByRole("radio", { name: /Team/ }).check();
  await access.getByRole("checkbox", { name: team }).check();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const job = page.getByRole("listitem").filter({ hasText: filename });
  await expect(job).toContainText(`Team: ${team}`);
  await expect(async () => {
    const retry = job.getByRole("button", { name: "Retry upload" });
    if (await retry.isVisible()) await retry.click();
    await expect(job.getByText("Done")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: LEARNING_TIME, intervals: [1_000] });

  // alice's list names the team on the document.
  await page.goto("/m/document");
  const aliceRow = page.getByRole("row").filter({ hasText: filename });
  await expect(aliceRow.getByText(team)).toBeVisible();

  // bob, a member, finds it under "Shared with me" and cannot change the sharing.
  const bobRow = bob.getByRole("row").filter({ hasText: filename });
  await expect(async () => {
    await bob.goto("/m/document");
    await bob.getByRole("checkbox", { name: "Shared with me" }).check();
    await expect(bobRow).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: LEARNING_TIME, intervals: [2_000] });
  await expect(bobRow.getByText(team)).toBeVisible();
  await bobRow.getByRole("link", { name: filename }).click();
  const bobShared = bob.locator("dt:text-is('Access') + dd");
  await expect(bobShared.getByText(team)).toBeVisible();
  await expect(bobShared.getByRole("button")).toHaveCount(0);
  // The owner's controls are not offered either.
  await expect(bob.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // alice makes the document public from its page; it stays visible to bob,
  // now as a public document, and a signed-in user outside the team can read it.
  await aliceRow.getByRole("link", { name: filename }).click();
  const shared = page.locator("dt:text-is('Access') + dd");
  const actions = page.getByRole("toolbar", { name: "Document actions" });
  await actions.getByRole("button", { name: "Change access" }).click();
  const dialog = page.getByRole("dialog", { name: "Who can read this document?" });
  await expect(dialog.getByRole("checkbox", { name: team })).toBeChecked();
  await dialog.getByRole("radio", { name: /Public/ }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(shared.getByText("Public")).toBeVisible();
  await bob.goto("/m/document");
  await expect(
    bob.getByRole("row").filter({ hasText: filename }).getByText("Public"),
  ).toBeVisible();

  // ... and back to the team.
  await actions.getByRole("button", { name: "Change access" }).click();
  await dialog.getByRole("radio", { name: /Team/ }).check();
  await dialog.getByRole("checkbox", { name: team }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(shared.getByText(team)).toBeVisible();
  await bob.goto("/m/document");
  await bob.getByRole("checkbox", { name: "Shared with me" }).check();
  await expect(bobRow.getByText(team)).toBeVisible();

  // Cleanup: alice deletes the document, then the team.
  await page.goto("/m/document");
  await aliceRow.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(aliceRow).toHaveCount(0);
  await page.goto("/m/iam/teams");
  await page.getByRole("link", { name: new RegExp(team) }).click();
  await page.getByRole("button", { name: "Delete team" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/m\/iam\/teams$/);
  await bobContext.close();
});
