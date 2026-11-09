import { Code, ConnectError } from "@connectrpc/connect";
import { type KbModule, KbRuntimeProvider, SearchError, type SearchProvider } from "@kb/module-sdk";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { badRequestDetail } from "@kb/ui/testing/errors";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { HeaderSearch } from "./HeaderSearch.tsx";
import { pagesProvider } from "./pages.ts";
import { SearchPage } from "./SearchPage.tsx";

const Icon = () => <svg aria-hidden="true" />;
const modules: KbModule[] = [{ id: "chat", title: "Chat", icon: Icon, routes: [] }];

const documents: SearchProvider = {
  label: "Documents",
  search: async (q) =>
    Array.from({ length: 8 }, (_, i) => ({
      title: `${q} ${i + 1}`,
      snippet: `passage ${i + 1}`,
      href: `/m/document/${i + 1}`,
    })),
};
const failing: SearchProvider = {
  label: "Conversations",
  search: () => Promise.reject(new Error("boom")),
};

function rejecting(label: string, err: unknown): SearchProvider {
  return { label, search: () => Promise.reject(err) };
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

/** The search page; with `header`, the sidebar's search field above it, as in the shell. */
function renderPage(providers: SearchProvider[], url: string, { header = false } = {}) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            {header && <HeaderSearch providers={providers} />}
            <SearchPage providers={providers} />
            <Where />
          </>
        ),
      },
    ],
    { initialEntries: [url] },
  );
  const result = render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <RouterProvider router={router} />
    </KbRuntimeProvider>,
  );
  return { ...result, router };
}

describe("SearchPage", () => {
  it("lists every hit of the query in the URL, grouped, with failures in their own group", async () => {
    const { container } = renderPage(
      [pagesProvider(modules), documents, failing],
      "/search?q=chat",
    );
    expect((screen.getByRole("searchbox", { name: "Search kb" }) as HTMLInputElement).value).toBe(
      "chat",
    );

    const docs = await screen.findByRole("region", { name: /Documents/ });
    expect(within(docs).getAllByRole("link")).toHaveLength(8);
    expect(within(docs).getByRole("link", { name: "chat 8" }).getAttribute("href")).toBe(
      "/m/document/8",
    );
    const pages = screen.getByRole("region", { name: /Pages/ });
    expect(within(pages).getByRole("link", { name: "Chat" }).getAttribute("href")).toBe("/m/chat");
    const conversations = screen.getByRole("region", { name: /Conversations/ });
    await waitFor(() =>
      expect(within(conversations).getByText("Couldn't search Conversations.")).toBeTruthy(),
    );
    expect(screen.getByRole("status").textContent).toBe('9 results for "chat"');
    await expectNoAxeViolations(container);
  });

  it("puts a new query in the URL", async () => {
    const { router } = renderPage([documents], "/search?q=a");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "q3 report" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(router.state.location.search).toBe("?q=q3+report");
    expect(await screen.findByRole("link", { name: "q3 report 1" })).toBeTruthy();
  });

  it("shows nothing without a query", () => {
    renderPage([documents], "/search");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("asks for a search term instead of searching for nothing", async () => {
    const { router } = renderPage([documents], "/search?q=report");
    await screen.findByRole("link", { name: "report 1" });
    const field = screen.getByRole("searchbox", { name: "Search kb" });
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByText("Enter a search term")).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(screen.getByText("Enter a search term").id);
    expect(document.activeElement).toBe(field);
    expect(router.state.location.search).toBe("?q=report");

    // Typing a term clears the message.
    fireEvent.change(field, { target: { value: "q" } });
    expect(screen.queryByText("Enter a search term")).toBeNull();
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("shows each group's failure in words, next to the other groups' hits", async () => {
    const llmDown = new SearchError(
      "Search needs the Models service, which isn't available right now.",
    );
    const rejected = new ConnectError("query required", Code.InvalidArgument);
    rejected.details.push(
      badRequestDetail([{ field: "query", description: "A query is required" }]),
    );
    renderPage(
      [
        pagesProvider(modules),
        rejecting("Documents", llmDown),
        rejecting("Conversations", new ConnectError("down", Code.Unavailable)),
        rejecting("Notes", rejected),
        rejecting("Help", new Error("boom")),
      ],
      "/search?q=chat",
    );
    const group = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });
    await waitFor(() =>
      expect(within(group("Help")).getByText("Couldn't search Help.")).toBeTruthy(),
    );
    expect(within(group("Pages")).getByRole("link", { name: "Chat" })).toBeTruthy();
    expect(within(group("Documents")).getByText(llmDown.message)).toBeTruthy();
    expect(
      within(group("Conversations")).getByText("Conversations isn't available right now."),
    ).toBeTruthy();
    expect(within(group("Notes")).getByText("A query is required")).toBeTruthy();
  });

  it("shows in the header's popup the first five of the page's hits, in the same order", async () => {
    renderPage([documents], "/search?q=report", { header: true });
    const page = await screen.findByRole("region", { name: /Documents/ });
    const pageHits = within(page)
      .getAllByRole("link")
      .map((l) => l.textContent);

    const header = screen.getByRole("combobox", { name: "Search kb" });
    fireEvent.focus(header);
    fireEvent.change(header, { target: { value: "report" } });
    const popup = await screen.findByRole("group", { name: "Documents" });
    const popupHits = within(popup)
      .getAllByRole("option")
      .map((o) => o.querySelector("span")?.textContent);
    expect(popupHits).toEqual(pageHits.slice(0, 5));
  });

  it("gets to the same address from the header's “See all results” and from the page's own field", async () => {
    const { router } = renderPage([documents], "/search", { header: true });
    const header = screen.getByRole("combobox", { name: "Search kb" });
    fireEvent.focus(header);
    fireEvent.change(header, { target: { value: "q3 report" } });
    fireEvent.click(await screen.findByRole("option", { name: /See all results/ }));
    const fromHeader = screen.getByTestId("where").textContent;
    expect(fromHeader).toBe("/search?q=q3+report");

    await router.navigate("/search");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search kb" }), {
      target: { value: "q3 report" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByTestId("where").textContent).toBe(fromHeader);
  });
});
