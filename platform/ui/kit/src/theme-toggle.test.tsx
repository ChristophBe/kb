import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "./testing/axe.ts";
import { ThemeToggle } from "./theme-toggle.tsx";

describe("ThemeToggle", () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("follows the system until the user picks a theme", async () => {
    const { container } = render(<ThemeToggle />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "System" }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await expectNoAxeViolations(container);
  });

  it("pins the chosen theme on the page and remembers it", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("knowcel.theme")).toBe("dark");

    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("knowcel.theme")).toBeNull();
  });

  it("starts from the remembered theme", () => {
    localStorage.setItem("knowcel.theme", "light");
    render(<ThemeToggle />);
    expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);
  });

  it("migrates the pre-rename kb.theme key once", () => {
    localStorage.setItem("kb.theme", "dark");
    render(<ThemeToggle />);
    expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem("knowcel.theme")).toBe("dark");
    expect(localStorage.getItem("kb.theme")).toBeNull();
  });

  it("prefers knowcel.theme over a stale kb.theme", () => {
    localStorage.setItem("kb.theme", "dark");
    localStorage.setItem("knowcel.theme", "light");
    render(<ThemeToggle />);
    expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);
  });

  it("drops an invalid legacy value without pinning it", () => {
    localStorage.setItem("kb.theme", "purple");
    render(<ThemeToggle />);
    expect((screen.getByRole("radio", { name: "System" }) as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem("kb.theme")).toBeNull();
    expect(localStorage.getItem("knowcel.theme")).toBeNull();
  });
});
