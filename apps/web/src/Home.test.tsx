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
    cta: { label: "Start a chat", path: "new" },
    prompt: { path: "new", label: "Ask a question", placeholder: "Ask anything…", submit: "Ask" },
  },
  widgets: { status: () => <p>Chat widget</p> },
});
const document = module("document", {
  feature: {
    headline: "Search by meaning",
    description: "Find the passage.",
    cta: { label: "Search documents", path: "search" },
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
    expect(links).toEqual(["/m/chat/new", "/m/document/search", "/m/ingestion", "/m/llm"]);
    expect(features.textContent).toContain("Models"); // fallback tile without a feature
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
      ["Search documents", "/m/document/search"],
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
});
