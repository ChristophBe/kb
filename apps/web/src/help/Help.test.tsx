import { expectNoAxeViolations } from "@kb/ui/testing";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpIndex, HelpPage } from "./Help.tsx";
import { helpHref, manualPages } from "./manual.ts";

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      { path: "/help", element: <HelpIndex /> },
      { path: "/help/:page", element: <HelpPage /> },
    ],
    { initialEntries: [url] },
  );
  return render(<RouterProvider router={router} />);
}

describe("manual", () => {
  it("bundles every page of docs/user-manual, in index order, without the README", () => {
    const slugs = manualPages.map((p) => p.slug);
    expect(slugs.slice(0, 2)).toEqual(["getting-started", "ingestion"]);
    expect(slugs).toEqual(expect.arrayContaining(["documents", "search", "chat", "models"]));
    expect(slugs).not.toContain("README");
    // A page missing from the README index would come without a summary.
    for (const p of manualPages) expect(p.summary, p.slug).not.toBe("");
  });

  it.each([
    ["chat.md", "/help/chat"],
    ["chat.md#stop-an-answer", "/help/chat#stop-an-answer"],
    ["./search.md#search-your-documents", "/help/search#search-your-documents"],
    ["README.md", "/help"],
    ["#ask-a-question", "#ask-a-question"],
    ["https://example.com/a.md", "https://example.com/a.md"],
  ])("links %s to %s", (href, to) => {
    expect(helpHref(href)).toBe(to);
  });
});

describe("HelpIndex", () => {
  it("links every manual page with its summary", async () => {
    const { container } = renderAt("/help");
    expect(screen.getByRole("heading", { level: 1, name: "Help" })).toBeTruthy();
    for (const p of manualPages) {
      expect(screen.getByRole("link", { name: new RegExp(p.title) }).getAttribute("href")).toBe(
        `/help/${p.slug}`,
      );
    }
    await expectNoAxeViolations(container);
  });
});

describe("HelpPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the page with an anchor per section and in-app links", async () => {
    const { container } = renderAt("/help/getting-started");
    expect(screen.getByRole("heading", { level: 1, name: "Getting started" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Find your way around" }).id).toBe(
      "find-your-way-around",
    );
    const chat = screen.getAllByRole("link", { name: "Chat" })[0];
    expect(chat?.getAttribute("href")).toBe("/help/chat");
    expect(screen.queryByText("Rules")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("scrolls to and focuses the section in the hash", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderAt("/help/chat#restrict-a-chat-to-some-documents");
    const section = screen.getByRole("heading", {
      level: 2,
      name: "Restrict a chat to some documents",
    });
    expect(section.id).toBe("restrict-a-chat-to-some-documents");
    expect(scroll.mock.contexts[0]).toBe(section);
    expect(document.activeElement).toBe(section);
  });

  it("says so for an unknown page", () => {
    renderAt("/help/nope");
    expect(screen.getByText(/There is no help page "nope"/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "All help pages" }).getAttribute("href")).toBe("/help");
  });
});
