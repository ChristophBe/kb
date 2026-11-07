import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("links a citation in the demo answer to its source", () => {
    render(<App />);
    const sources = screen.getByRole("list", { name: "Sources" });
    const marker = screen.getByRole("button", { name: /^Source 2:/ });
    fireEvent.focus(marker);
    const notes = within(sources).getAllByRole("listitem");
    expect(notes[1]?.className).toContain("border-accent");
    expect(notes[0]?.className).not.toContain("border-accent");
    fireEvent.blur(marker);
    expect(notes[1]?.className).not.toContain("border-accent");
  });

  it("prerenders the content, so the page reads without JavaScript", () => {
    const html = renderStatic();
    expect(html).toContain("Ask your documents");
    expect(html).toContain("task up -- --profile ollama");
  });
});
