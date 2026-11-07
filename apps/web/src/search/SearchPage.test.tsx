import { type KbModule, KbRuntimeProvider, type SearchProvider } from "@kb/module-sdk";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { searchProviders } from "./pages.ts";
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

function renderPage(providers: SearchProvider[], url: string) {
  const router = createMemoryRouter(
    [{ path: "/search", element: <SearchPage providers={providers} /> }],
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
      [...searchProviders(modules), documents, failing],
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
});
