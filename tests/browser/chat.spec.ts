import { expect, test } from "@playwright/test";

// Picking a conversation in the list opens it (#229). The list's links are
// relative to the chat module; mounted under the shell's lazy route they once
// led to /m/chat/<open id>/<picked id>, a page that doesn't exist.
test("picking a conversation in the list opens it", async ({ page }) => {
  await page.goto("/m/chat");
  const newChat = page.getByRole("button", { name: "New chat" });
  const open = /\/m\/chat\/[^/]+$/;

  await newChat.click();
  await expect(page).toHaveURL(open);
  const first = new URL(page.url()).pathname;

  await newChat.click();
  // The first conversation's address matches `open` too: wait for the change.
  await expect(page).not.toHaveURL(new RegExp(`${first}$`));
  await expect(page).toHaveURL(open);
  const second = new URL(page.url()).pathname;

  // Back to the first one, by its entry in the list.
  const list = page.getByRole("navigation", { name: "Conversations" });
  await list.locator(`a[href="${first}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${first}$`));
  await expect(list.locator(`a[href="${first}"]`)).toHaveAttribute("aria-current", "page");
  await expect(page.getByPlaceholder("Ask something…")).toBeVisible();

  // And once more to the other one, to check it works from either page.
  await list.locator(`a[href="${second}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${second}$`));
  await expect(list.locator(`a[href="${second}"]`)).toHaveAttribute("aria-current", "page");
});

test("the Chat entry in the sidebar stays active on the chat pages", async ({ page }) => {
  const nav = page.getByRole("link", { name: "Chat", exact: true });
  await page.goto("/");
  await expect(page).toHaveURL(/\/m\/chat$/);
  await expect(nav).toHaveAttribute("aria-current", "page");
  await page.goto("/m/chat/new");
  await expect(nav).toHaveAttribute("aria-current", "page");
});
