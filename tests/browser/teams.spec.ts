import { expect, test } from "@playwright/test";
import { users } from "./users.ts";

// A team admin adds a second user by email and promotes them (#264). The shell
// registers each user with the IAM module when they open it, so bob has to have
// opened the app before alice can add him.
test("an admin creates a team, adds a second user and promotes them", async ({ page, browser }) => {
  const name = `Platform ${Date.now()}`;

  const bobContext = await browser.newContext({ storageState: users.bob.storageState });
  const bob = await bobContext.newPage();
  const registered = bob.waitForResponse((r) => r.url().includes("IamService/GetCurrentUser"));
  await bob.goto("/m/iam/teams");
  await registered;

  await page.goto("/m/iam/teams");
  await page.getByLabel("New team").fill(name);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page).toHaveURL(/\/m\/iam\/teams\/[^/]+$/);

  await page.getByLabel("Add a member by email").fill(users.bob.email);
  await page.getByRole("button", { name: "Add member" }).click();
  const bobRow = page.getByRole("row", { name: new RegExp(users.bob.email) });
  await expect(bobRow).toBeVisible();
  await expect(bobRow.getByRole("combobox")).toHaveValue("2");

  // As a plain member, bob sees the team but none of the admin controls.
  await bob.reload();
  await bob.getByRole("link", { name: new RegExp(name) }).click();
  await expect(bob.getByRole("table", { name: "Members" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Leave team" })).toBeVisible();
  await expect(bob.getByLabel("Add a member by email")).toHaveCount(0);
  await expect(bob.getByRole("button", { name: "Delete team" })).toHaveCount(0);
  await expect(bob.getByRole("table", { name: "Members" }).getByRole("combobox")).toHaveCount(0);

  await bobRow.getByRole("combobox").selectOption({ label: "Admin" });
  await expect(bobRow.getByRole("combobox")).toHaveValue("1");

  // Promoted, bob gets them.
  await bob.reload();
  await expect(bob.getByLabel("Add a member by email")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Delete team" })).toBeVisible();

  // Cleanup: alice deletes the team.
  await page.getByRole("button", { name: "Delete team" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/m\/iam\/teams$/);
  await bobContext.close();
});
