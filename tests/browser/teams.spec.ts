import { expect, test } from "@playwright/test";
import { users } from "./users.ts";

// Role changes say so, and demoting yourself asks first (#309). Unique per run.
const team = `Roles ${Date.now().toString(36)}`;

test("a role change shows a toast, and demoting yourself asks first", async ({ page, browser }) => {
  // bob has to have opened the app before alice can add him by email.
  const bobContext = await browser.newContext({ storageState: users.bob.storageState });
  const bob = await bobContext.newPage();
  const registered = bob.waitForResponse((r) => r.url().includes("IamService/GetCurrentUser"));
  await bob.goto("/m/iam/teams");
  await registered;
  await bobContext.close();

  await page.goto("/m/iam/teams");
  await page.getByLabel("New team").fill(team);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: team })).toBeVisible();
  await page.getByLabel("Add a member by email").fill(users.bob.email);
  await page.getByRole("button", { name: "Add member" }).click();
  const bobRow = page.getByRole("row", { name: new RegExp(users.bob.email) });
  await expect(bobRow).toBeVisible();

  await bobRow.getByRole("combobox").selectOption("Admin");
  await expect(page.getByText(/role is now Admin/)).toBeVisible();

  // Alice demotes herself: nothing is saved until she confirms.
  const aliceRow = page.getByRole("row", { name: new RegExp(users.alice.email) });
  await aliceRow.getByRole("combobox").selectOption("Member");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Make yourself a member?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(aliceRow.getByRole("combobox")).toHaveValue("1");

  await aliceRow.getByRole("combobox").selectOption("Member");
  await dialog.getByRole("button", { name: "Make me a member" }).click();
  await expect(page.getByText("Your role is now Member")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
});
