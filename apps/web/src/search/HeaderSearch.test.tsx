import { type KbModule, KbRuntimeProvider, type SearchProvider } from "@kb/module-sdk";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { HeaderSearch } from "./HeaderSearch.tsx";
import { pagesProvider, searchProviders } from "./pages.ts";

const Icon = () => <svg aria-hidden="true" />;

const modules: KbModule[] = [
  {
    id: "document",
    title: "Documents",
    icon: Icon,
    routes: [],
    nav: [
      { path: "", label: "Documents" },
      { path: "search", label: "Search" },
    ],
  },
  { id: "chat", title: "Chat", icon: Icon, routes: [] },
];

function provider(label: string, n: number, extra: Partial<SearchProvider> = {}): SearchProvider {
  return {
    label,
    search: async (q) =>
      Array.from({ length: n }, (_, i) => ({
        title: `${label} ${q} ${i + 1}`,
        snippet: `snippet ${i + 1}`,
        href: `/m/${label.toLowerCase()}/${i + 1}`,
      })),
    ...extra,
  };
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderSearch(providers: SearchProvider[]) {
  const router = createMemoryRouter([
    {
      path: "*",
      element: (
        <>
          <HeaderSearch providers={providers} />
          <Where />
        </>
      ),
    },
  ]);
  const result = render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <RouterProvider router={router} />
    </KbRuntimeProvider>,
  );
  return { ...result, router };
}

const field = () => screen.getByRole("combobox", { name: "Search kb" });
const where = () => screen.getByTestId("where").textContent;

function type(text: string) {
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: text } });
}

describe("HeaderSearch", () => {
  it("groups hits by provider, five per group at most", async () => {
    const { container } = renderSearch([
      pagesProvider(modules),
      provider("Documents", 7),
      provider("Conversations", 2),
    ]);
    type("cha");

    const list = await screen.findByRole("listbox", { name: "Search results" });
    expect(field().getAttribute("aria-expanded")).toBe("true");
    expect(field().getAttribute("aria-controls")).toBe(list.id);
    expect(within(list).getAllByRole("group")).toHaveLength(3);
    expect(within(list).getByRole("group", { name: "Pages" })).toBeTruthy();
    expect(
      within(within(list).getByRole("group", { name: "Documents" })).getAllByRole("option"),
    ).toHaveLength(5);
    expect(
      within(within(list).getByRole("group", { name: "Conversations" })).getAllByRole("option"),
    ).toHaveLength(2);
    expect(within(list).getByRole("option", { name: "See all results for “cha”" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("8 results."));
    await expectNoAxeViolations(container);
    await expectNoAxeViolations(list);
  });

  it("lists the Chat page under Pages", async () => {
    renderSearch(searchProviders(modules));
    type("chat");
    const pages = await screen.findByRole("group", { name: "Pages" });
    expect(
      within(pages)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Chat"]);
  });

  it("moves through the hits with the arrow keys and opens one with Enter", async () => {
    renderSearch([provider("Documents", 2)]);
    type("report");
    await screen.findByRole("option", { name: /Documents report 1/ });
    expect(field().getAttribute("aria-activedescendant")).toBeNull();

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    const first = screen.getByRole("option", { name: /Documents report 1/ });
    expect(field().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /See all results/ }).id,
    );
    // Wraps around, in both directions.
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field().getAttribute("aria-activedescendant")).toBe(first.id);
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    const second = screen.getByRole("option", { name: /Documents report 2/ });
    expect(field().getAttribute("aria-activedescendant")).toBe(second.id);

    fireEvent.keyDown(field(), { key: "Enter" });
    expect(where()).toBe("/m/documents/2");
    expect((field() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens the search page with Enter when no hit is highlighted", async () => {
    renderSearch([provider("Documents", 1)]);
    type("q3 report");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(where()).toBe("/search?q=q3+report");
  });

  it("closes with Escape, then clears the field with a second Escape", async () => {
    renderSearch([provider("Documents", 1)]);
    type("report");
    await screen.findByRole("listbox");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field().getAttribute("aria-expanded")).toBe("false");
    expect((field() as HTMLInputElement).value).toBe("report");

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(await screen.findByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Escape" });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("opens a hit on click", async () => {
    renderSearch([provider("Documents", 1)]);
    type("report");
    fireEvent.click(await screen.findByRole("option", { name: /Documents report 1/ }));
    expect(where()).toBe("/m/documents/1");
  });

  it("shows a failing provider's error and a slow one's spinner in their own groups", async () => {
    const failing = provider("Conversations", 0, {
      search: () => Promise.reject(new Error("boom")),
    });
    const slow = provider("Help", 0, { search: () => new Promise(() => {}) });
    renderSearch([provider("Documents", 2), failing, slow]);
    type("report");

    const list = await screen.findByRole("listbox");
    await waitFor(() =>
      expect(within(list).getByText("Couldn't search Conversations.")).toBeTruthy(),
    );
    const help = within(list).getByRole("group", { name: "Help" });
    expect(within(help).getByTestId("group-spinner")).toBeTruthy();
    expect(within(help).getByText("Searching…")).toBeTruthy();
    expect(within(list).getAllByRole("option", { name: /Documents report/ })).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toBe(
      "2 results, still searching. Couldn't search Conversations.",
    );
  });

  it("debounces typing and aborts the previous query", async () => {
    const signals: AbortSignal[] = [];
    const search = vi.fn(async (q: string, signal: AbortSignal) => {
      signals.push(signal);
      return [{ title: q, href: "/x" }];
    });
    renderSearch([{ label: "Documents", search }]);
    type("r");
    type("re");
    type("rep");
    await screen.findByRole("option", { name: "rep" });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe("rep");

    type("repo");
    await screen.findByRole("option", { name: "repo" });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("focuses the field with ⌘K or Ctrl+K", () => {
    renderSearch([]);
    expect(document.activeElement).not.toBe(field());
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(field());
    field().blur();
    fireEvent.keyDown(window, { key: "K", ctrlKey: true });
    expect(document.activeElement).toBe(field());
  });
});
