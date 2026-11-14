import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo, Mark } from "./logo.tsx";
import { expectNoAxeViolations } from "./testing/axe.ts";

const nodes = (svg: Element) => svg.querySelectorAll("circle").length;
const radius = (svg: Element) => svg.querySelector("circle")?.getAttribute("r");

describe("Mark", () => {
  it("is decorative without a label", () => {
    const { container } = render(<Mark />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is an image when labelled", async () => {
    const { container } = render(<Mark label="Knowcelium" size={32} />);
    expect(screen.getByRole("img", { name: "Knowcelium" })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("uses the small cut at 24px and below and the full cut above", () => {
    const { container } = render(
      <>
        <Mark size={16} />
        <Mark size={24} />
        <Mark size={32} />
      </>,
    );
    const svgs = Array.from(container.querySelectorAll("svg"));
    expect(svgs.map(radius)).toEqual(["4.4", "4.4", "3.4"]);
    for (const svg of svgs) expect(nodes(svg)).toBe(5);
  });

  it("takes a size and a class", () => {
    const { container } = render(<Mark size={40} className="text-accent" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("40");
    expect(svg?.getAttribute("class")).toContain("text-accent");
  });
});

describe("Logo", () => {
  it("shows the mark and the wordmark", async () => {
    const { container } = render(<Logo />);
    expect(screen.getByText("knowcelium")).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await expectNoAxeViolations(container);
  });
});
