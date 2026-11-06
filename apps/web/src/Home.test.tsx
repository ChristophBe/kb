import type { KbModule } from "@kb/module-sdk";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { render, screen } from "@testing-library/react";
import { FileText, MessageSquare, Search } from "lucide-react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Home } from "./App.tsx";

const modules: KbModule[] = [
  { id: "chat", title: "Chat", icon: MessageSquare, routes: [] },
  {
    id: "document",
    title: "Documents",
    icon: FileText,
    routes: [],
    nav: [
      { path: "", label: "Documents" },
      { path: "search", label: "Search", icon: Search },
    ],
  },
];

describe("Home", () => {
  it("has a card for every sidebar entry of the modules, in sidebar order", async () => {
    const { container } = render(
      <MemoryRouter>
        <Home modules={modules} />
      </MemoryRouter>,
    );
    const cards = screen.getAllByRole("link");
    expect(cards.map((c) => [c.textContent, c.getAttribute("href")])).toEqual([
      ["Chat", "/m/chat"],
      ["Documents", "/m/document"],
      ["Search", "/m/document/search"],
    ]);
    await expectNoAxeViolations(container);
  });
});
