import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { render as renderStatic } from "./entry-server.tsx";

describe("marketing site", () => {
  it("has one title and a section for every nav link", async () => {
    const { container } = render(<App />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const link of within(nav).getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) expect(container.querySelector(href)).not.toBeNull();
    }
    expect(container.querySelector("#quick-start")).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it("shows the demo as a recording nobody can interact with", () => {
    render(<App />);
    const demo = screen.getByRole("figure", { name: /recording/ });
    expect(within(demo).queryAllByRole("button")).toHaveLength(0);
    expect(within(demo).queryAllByRole("link")).toHaveLength(0);
    expect(demo.className).toContain("pointer-events-none");
    expect(within(demo).getByText("Demo recording")).not.toBeNull();
  });

  it("prerenders the content, so the page reads without JavaScript", () => {
    const html = renderStatic();
    expect(html).toContain("Everything your organization knows");
    for (const pillar of ["Absorb", "Connect", "Renew"]) expect(html).toContain(pillar);
    expect(html).toContain("On the roadmap");
    expect(html).toContain("Drop PDFs, Markdown or text files here");
    expect(html).toContain("task up:release");
  });
});
