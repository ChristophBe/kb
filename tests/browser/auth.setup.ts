import { expect, test as setup } from "@playwright/test";
import { users } from "./users.ts";

// Signs each user in the way a person does: the shell sends the browser to
// Dex's login form and back. The saved state holds the OIDC session the shell
// keeps in localStorage, so the tests start signed in.
for (const [name, user] of Object.entries(users)) {
  setup(`sign in as ${name}`, async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole("button", { name: /log ?in/i }).click();
    await expect(page.getByText(user.email)).toBeVisible();
    await page.context().storageState({ path: user.storageState });
  });
}
