import { expect, type Page, test } from "@playwright/test";
import { users } from "./users.ts";

// Alice is the platform admin the dev stack bootstraps (KNOWCEL_IAM_BOOTSTRAP_ADMINS);
// bob is not. The shell registers each user when they open it, so bob has to have
// opened the app before alice sees him in the directory (#265).
// The sidebar's page list; the home page and other pages link to Teams too.
const sidebar = (p: Page) => p.getByRole("navigation").first();

test("platform admins manage the user directory, other users never see it", async ({
  page,
  browser,
}) => {
  const bobContext = await browser.newContext({ storageState: users.bob.storageState });
  const bob = await bobContext.newPage();
  const registered = bob.waitForResponse((r) => r.url().includes("IamService/GetCurrentUser"));
  await bob.goto("/");
  await registered;

  // Bob has no Users link, and the page itself refuses him.
  await expect(sidebar(bob).getByRole("link", { name: "Teams" })).toBeVisible();
  await expect(sidebar(bob).getByRole("link", { name: "Users" })).toHaveCount(0);
  await bob.goto("/m/iam/users");
  await expect(bob.getByText("Only platform admins can see the users.")).toBeVisible();
  await expect(bob.getByRole("table", { name: "Users" })).toHaveCount(0);

  // Alice finds the page in the sidebar.
  await page.goto("/");
  await sidebar(page).getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/m\/iam\/users$/);
  const bobRow = page.getByRole("row", { name: new RegExp(users.bob.email) });
  await expect(bobRow).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(users.alice.email) })).toContainText(
    "Platform admin",
  );

  try {
    await bobRow.getByRole("button", { name: /^Promote/ }).click();
    await expect(bobRow).toContainText("Platform admin");

    // Promoted, bob gets the page after a reload.
    await bob.reload();
    await expect(bob.getByRole("table", { name: "Users" })).toBeVisible();
    await expect(sidebar(bob).getByRole("link", { name: "Users" })).toBeVisible();
  } finally {
    await bobRow.getByRole("button", { name: /^Demote/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Demote" }).click();
    await expect(bobRow).not.toContainText("Platform admin");
  }

  // The last platform admin stays.
  await page
    .getByRole("row", { name: new RegExp(users.alice.email) })
    .getByRole("button", { name: /^Demote/ })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Demote" }).click();
  await expect(page.getByText(/needs at least one admin/)).toBeVisible();
  await bobContext.close();
});
