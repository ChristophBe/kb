import { expect, test } from "@playwright/test";
import { users } from "./users.ts";

// The stack runs the fake provider, which has models to list but none to pull
// or delete: what matters here is who gets the controls (#55). Alice is the
// platform admin the dev stack bootstraps (KNOWCEL_IAM_BOOTSTRAP_ADMINS); bob is not.
test("platform admins get the model controls, other users only the list", async ({
  page,
  browser,
}) => {
  const bobContext = await browser.newContext({ storageState: users.bob.storageState });
  const bob = await bobContext.newPage();
  // The controls follow the registered user, so wait for it.
  const registered = bob.waitForResponse((r) => r.url().includes("IamService/GetCurrentUser"));
  await bob.goto("/m/llm");
  await registered;
  await expect(bob.getByRole("heading", { name: "Models" })).toBeVisible();
  await expect(bob.getByRole("list").getByText("fake-chat")).toBeVisible();
  await expect(bob.getByLabel("Pull a model")).toHaveCount(0);
  await expect(bob.getByRole("button", { name: /^Delete / })).toHaveCount(0);

  await page.goto("/m/llm");
  await expect(page.getByRole("list").getByText("fake-chat")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete fake-chat" })).toBeVisible();

  // The provider says it can't manage models; the page tells the admin so.
  await page.getByLabel("Pull a model").fill("llama3.2");
  await page.getByRole("button", { name: "Pull" }).click();
  await expect(page.getByText("This provider's models can't be managed here.")).toBeVisible();

  await page.getByRole("button", { name: "Delete fake-chat" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("This provider's models can't be managed here.")).toBeVisible();
  await expect(page.getByRole("list").getByText("fake-chat")).toBeVisible();
  await bobContext.close();
});
