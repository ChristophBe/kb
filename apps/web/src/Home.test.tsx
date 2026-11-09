import { createRouterTransport } from "@connectrpc/connect";
import type { KbModule } from "@kb/module-sdk";
import { renderWithRuntime } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { Home } from "./Home.tsx";
import { activeModules } from "./registry.ts";

const Icon = () => <svg aria-hidden="true" />;

function module(id: string, extra: Partial<KbModule> = {}): KbModule {
  return { id, title: id, icon: Icon, routes: [], ...extra };
}

const chat = module("chat", {
  feature: {
    headline: "Ask, get cited answers",
    description: "Answers from your documents.",
    cta: { label: "Start a chat", path: "new" },
    prompt: { path: "new", label: "Ask a question", placeholder: "Ask anything…", submit: "Ask" },
  },
  widgets: { status: () => <p>Chat widget</p> },
});
const document = module("document", {
  feature: {
    headline: "Search by meaning",
    description: "Find the passage.",
    cta: { label: "Search documents", path: "/search" },
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
      "Ask your documents anything.",
    );
    const widgets = screen.getByRole("region", { name: "Pick up where you left off" });
    expect(widgets.textContent).toBe("Pick up where you left offChat widget");

    const features = screen.getByRole("region", { name: "One place for everything you know" });
    const links = [...features.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/m/chat/new", "/search", "/m/ingestion", "/m/llm"]);
    expect(features.textContent).toContain("Models"); // fallback tile without a feature
    // The halo is decoration only.
    expect(container.querySelector("header > [aria-hidden='true']")).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("offers the first two features besides the prompt as hero actions", () => {
    renderHome([chat, document, ingestion, plain]);
    const hero = screen.getByRole("banner");
    const actions = [...hero.querySelectorAll("a")].map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(actions).toEqual([
      ["Search documents", "/search"],
      ["Upload documents", "/m/ingestion"],
    ]);
  });

  it("starts the prompt's module with the question", () => {
    renderHome([chat, document]);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask a question" }), {
      target: { value: "  How did revenue develop? " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByTestId("where").textContent).toBe(
      "/m/chat/new?q=How+did+revenue+develop%3F",
    );
  });

  it("leaves out the prompt when no module provides one", () => {
    renderHome([document, ingestion, plain]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("leaves out the widgets' section when no module has widgets", () => {
    renderHome([document, ingestion, plain]);
    expect(screen.queryByRole("region", { name: "Pick up where you left off" })).toBeNull();
  });

  it("shows the widgets of the enabled modules only", async () => {
    const modules = activeModules({ apiBaseUrl: "http://test", enabledModules: ["chat", "llm"] });
    const router = createMemoryRouter([{ path: "/", element: <Home modules={modules} /> }]);
    // No service answers: every widget shows that its data can't be loaded, the page stays.
    const transport = createRouterTransport(() => {});
    // The widgets are lazy; React only retries a suspended render begun in an awaited act().
    await act(async () => {
      renderWithRuntime(<RouterProvider router={router} />, transport);
    });
    expect(await screen.findByText("Your conversations can't be loaded right now.")).toBeTruthy();
    expect(await screen.findByText("The providers can't be checked right now.")).toBeTruthy();
    const widgets = screen.getByRole("region", { name: "Pick up where you left off" });
    const titles = [...widgets.querySelectorAll("h3")].map((h) => h.textContent);
    expect(titles).toEqual(["Recent conversations", "Models"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
