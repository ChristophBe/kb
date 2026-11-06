import type { KbModule } from "@kb/module-sdk";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { Home } from "./Home.tsx";

const Icon = () => <svg aria-hidden="true" />;

function module(id: string, extra: Partial<KbModule> = {}): KbModule {
  return { id, title: id, icon: Icon, routes: [], ...extra };
}

const chat = module("chat", {
  feature: {
    headline: "Ask, get cited answers",
    description: "Answers from your documents.",
    cta: { label: "Ask a question", path: "" },
  },
  widgets: { status: () => <p>Chat widget</p> },
});
const document = module("document", {
  feature: {
    headline: "Search by meaning",
    description: "Find the passage.",
    cta: { label: "Search documents", path: "search" },
    search: "search",
  },
});
const ingestion = module("ingestion", {
  feature: {
    headline: "Bring in what you know",
    description: "Upload.",
    cta: { label: "Upload documents", path: "" },
  },
});
const plain = module("llm", { title: "Models" });

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderHome(modules: KbModule[]) {
  const router = createMemoryRouter([
    { path: "/", element: <Home modules={modules} /> },
    { path: "*", element: <Where /> },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("Home", () => {
  it("leads with the hero, then every feature, then module widgets", async () => {
    const { container } = renderHome([chat, document, ingestion, plain]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Your documents, ready to answer.",
    );
    expect(screen.getByText("Chat widget")).toBeTruthy();

    const features = screen.getByRole("region", { name: "Everything kb can do" });
    const links = [...features.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/m/chat", "/m/document/search", "/m/ingestion", "/m/llm"]);
    expect(features.textContent).toContain("Models"); // fallback tile without a feature
    await expectNoAxeViolations(container);
  });

  it("offers the first two non-search features as hero actions", () => {
    renderHome([chat, document, ingestion, plain]);
    const hero = screen.getByRole("banner");
    const actions = [...hero.querySelectorAll("a")].map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(actions).toEqual([
      ["Ask a question", "/m/chat"],
      ["Upload documents", "/m/ingestion"],
    ]);
  });

  it("searches the module that declares search", () => {
    renderHome([chat, document]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your documents" }), {
      target: { value: "  revenue 2025 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByTestId("where").textContent).toBe("/m/document/search?q=revenue+2025");
  });

  it("leaves out the search box when no module provides search", () => {
    renderHome([ingestion, plain]);
    expect(screen.queryByRole("search")).toBeNull();
  });
});
