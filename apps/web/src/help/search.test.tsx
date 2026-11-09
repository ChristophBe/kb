import { KbRuntimeProvider, type SearchContext } from "@kb/module-sdk";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderSearch } from "../search/HeaderSearch.tsx";
import { HelpPage } from "./Help.tsx";
import { manualPages } from "./manual.ts";
import { HELP_SEARCH_LIMIT, helpProvider, pageSections, plainText } from "./search.ts";

const context = {} as SearchContext;
const signal = new AbortController().signal;
const search = (q: string) => helpProvider.search(q, signal, context);

describe("plainText", () => {
  it.each([
    ["Select **Rename** next to its title.", "Select Rename next to its title."],
    ["You can [rename it](#rename-a-conversation).", "You can rename it."],
    ["1. Open `chat`\n2. Type _it_", "Open chat Type it"],
    ["- one\n- two", "one two"],
    ["| A | B |\n| --- | --- |\n| 1 | 2 |", "A B 1 2"],
    ["Uses snake_case names", "Uses snake_case names"],
  ])("%j → %j", (md, text) => {
    expect(plainText(md)).toBe(text);
  });
});

describe("pageSections", () => {
  it("splits a page at its h2 and h3 headings, linking each section", () => {
    const chat = manualPages.find((p) => p.slug === "chat");
    if (!chat) throw new Error("no chat page");
    const sections = pageSections(chat);
    expect(sections[0]).toMatchObject({ heading: "", href: "/help/chat" });
    const rename = sections.find((s) => s.heading === "Rename a conversation");
    expect(rename?.href).toBe("/help/chat#rename-a-conversation");
    expect(rename?.text).toMatch(/^Open the conversation and select Rename next to its title\./);
    expect(rename?.text).not.toMatch(/[*#[\]]/);
  });
});

describe("helpProvider", () => {
  it("lists heading matches before text matches", async () => {
    const hits = await search("RENAME");
    expect(hits).toContainEqual({
      title: "Rename a conversation",
      snippet: expect.stringMatching(/^Chat · Open the conversation and select Rename/),
      href: "/help/chat#rename-a-conversation",
    });
    const hrefs = hits.map((h) => h.href);
    // "Who can see your conversations" mentions renaming too, but only in its text.
    expect(hrefs.indexOf("/help/chat#who-can-see-your-conversations")).toBeGreaterThan(
      hrefs.indexOf("/help/chat#rename-a-conversation"),
    );
    expect(hits.slice(0, 2).map((h) => h.title)).toEqual([
      "Rename a document",
      "Rename a conversation",
    ]);
  });

  it("shows the matching text, without Markdown, in the snippet", async () => {
    const hits = await search("best matching passage");
    const hit = hits.find((h) => h.href === "/help/search#search-your-documents");
    expect(hit?.snippet).toMatch(/^Search · .*best matching passage/);
    expect(hit?.snippet).not.toMatch(/\*\*|\]\(/);
  });

  it("needs every word, and caps the hits", async () => {
    expect(await search("rename zebra")).toEqual([]);
    expect(await search("  ")).toEqual([]);
    expect((await search("the")).length).toBe(HELP_SEARCH_LIMIT);
  });
});

describe("Help in the header search", () => {
  afterEach(() => vi.restoreAllMocks());

  it("finds the section about renaming conversations and opens it", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const router = createMemoryRouter([
      {
        path: "*",
        element: <HeaderSearch providers={[helpProvider]} />,
      },
      {
        path: "/help/:page",
        element: (
          <>
            <HeaderSearch providers={[helpProvider]} />
            <HelpPage />
          </>
        ),
      },
    ]);
    render(
      <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
        <RouterProvider router={router} />
      </KbRuntimeProvider>,
    );
    const field = screen.getByRole("combobox", { name: "Search kb" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "rename" } });

    const help = await screen.findByRole("group", { name: "Help" });
    fireEvent.click(within(help).getByRole("option", { name: /^Rename a conversation/ }));

    expect(router.state.location.pathname).toBe("/help/chat");
    expect(router.state.location.hash).toBe("#rename-a-conversation");
    const section = await screen.findByRole("heading", {
      level: 2,
      name: "Rename a conversation",
    });
    await waitFor(() => expect(document.activeElement).toBe(section));
    expect(scroll.mock.contexts.at(-1)).toBe(section);
  });
});
