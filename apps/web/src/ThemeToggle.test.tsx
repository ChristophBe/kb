import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle.tsx";

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
    expect(localStorage.getItem("kb.theme")).toBe("dark");

    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("kb.theme")).toBeNull();
  });

  it("starts from the remembered theme", () => {
    localStorage.setItem("kb.theme", "light");
    render(<ThemeToggle />);
    expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);
  });
});
