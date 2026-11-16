import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  return render(<App config={{ apiBaseUrl: "http://gateway", enabledModules: [] }} />);
}

describe("App shell", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("has a skip link first, an aside and labelled navs", async () => {
    const { container } = renderAt("/nope");
    const first = container.querySelector("a, button, input");
    expect(first?.textContent).toBe("Skip to content");
    expect(container.querySelector("aside")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Help" })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("points the skip link at the focusable main region", () => {
    renderAt("/nope");
    const target = screen.getByRole("main");
    expect(screen.getByText("Skip to content").getAttribute("href")).toBe(`#${target.id}`);
    expect(target.tabIndex).toBe(-1);
  });

  it("shows a titled 404 page with a way back", () => {
    renderAt("/nope");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the start page" }).getAttribute("href")).toBe(
      "/",
    );
    expect(document.title).toBe("Page not found · Knowcelium");
  });

  it("moves focus to the page heading after a route change", async () => {
    renderAt("/nope");
    // The first page load keeps focus where it is.
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("link", { name: "Help" }));
    await waitFor(() => {
      const h1 = screen.getByRole("heading", { level: 1 });
      expect(document.activeElement).toBe(h1);
    });
  });

  describe("at a narrow width", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    // jsdom applies no CSS: a closed drawer is `inert` (out of the tab order and the
    // accessibility tree), where a browser also hides it.
    const sidebarClosed = (c: HTMLElement) => c.querySelector("aside")?.hasAttribute("inert");

    it("keeps the sidebar closed until the menu button opens it", () => {
      const { container } = renderAt("/nope");
      expect(sidebarClosed(container)).toBe(true);
      const menu = screen.getByRole("button", { name: "Open menu" });
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(menu);
      expect(sidebarClosed(container)).toBe(false);
      expect(menu.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector("main")?.hasAttribute("inert")).toBe(true);
      expect(container.querySelector("aside")?.contains(document.activeElement)).toBe(true);
    });

    it("closes on Escape and returns focus to the menu button", () => {
      const { container } = renderAt("/nope");
      const menu = screen.getByRole("button", { name: "Open menu" });
      fireEvent.click(menu);
      fireEvent.keyDown(screen.getByRole("navigation", { name: "Help" }), { key: "Escape" });
      expect(sidebarClosed(container)).toBe(true);
      expect(document.activeElement).toBe(menu);
    });

    it("closes on navigation", async () => {
      const { container } = renderAt("/nope");
      fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
      fireEvent.click(screen.getByRole("link", { name: "Help" }));
      await waitFor(() => expect(sidebarClosed(container)).toBe(true));
    });
  });
});
