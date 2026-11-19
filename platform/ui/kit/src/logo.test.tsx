import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyBranding } from "./branding.ts";
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

describe("Logo with branding", () => {
  afterEach(() => applyBranding(undefined));

  it("shows the logo images for light and dark mode, named after the product", () => {
    applyBranding({
      name: "Acme Knowledge",
      logo: { light: "/branding/light.svg", dark: "/branding/dark.svg" },
    });
    render(<Logo />);
    const images = screen.getAllByAltText("Acme Knowledge") as HTMLImageElement[];
    expect(images.map((i) => i.getAttribute("src"))).toEqual([
      "/branding/light.svg",
      "/branding/dark.svg",
    ]);
    expect(images.map((i) => i.className)).toEqual([
      expect.stringContaining("brand-logo-light"),
      expect.stringContaining("brand-logo-dark"),
    ]);
  });

  it("shows a single logo in both modes", () => {
    applyBranding({ logo: { dark: "/branding/dark.svg" } });
    render(<Logo />);
    const images = screen.getAllByAltText("Knowcelium");
    expect(images).toHaveLength(1);
    expect(images[0]?.className).not.toContain("brand-logo-");
  });

  it("shows the product name as text without a logo", () => {
    applyBranding({ name: "Acme Knowledge" });
    const { container } = render(<Logo />);
    expect(container.textContent).toBe("Acme Knowledge");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("labels the mark with the product name", () => {
    applyBranding({ name: "Acme Knowledge" });
    const { container } = render(<Mark />);
    expect(container.querySelector("title")?.textContent).toBe("Acme Knowledge");
  });
});

// --- logo.showName (#360) ---
describe("Logo with showName", () => {
  const logo = { light: "/branding/logo.svg" };

  it("shows the product name under the logo image", async () => {
    applyBranding({ name: "Acme Knowledge", logo: { ...logo, showName: true } });
    const { container } = render(<Logo />);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/branding/logo.svg");
    // The text names it; the image alone would repeat it.
    expect(image?.getAttribute("alt")).toBe("");
    const name = screen.getByText("Acme Knowledge");
    expect(image?.compareDocumentPosition(name)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expectNoAxeViolations(container);
  });

  it("shows the image alone when false or unset", () => {
    for (const showName of [false, undefined]) {
      applyBranding({ name: "Acme Knowledge", logo: { ...logo, showName } });
      const { container, unmount } = render(<Logo />);
      expect(container.textContent).toBe("");
      expect(screen.getByAltText("Acme Knowledge")).toBeTruthy();
      unmount();
    }
  });

  it("keeps the image only where the name is turned off (the mobile header)", () => {
    applyBranding({ name: "Acme Knowledge", logo: { ...logo, showName: true } });
    const { container } = render(<Logo nameUnderImage={false} />);
    expect(container.textContent).toBe("");
    expect(screen.getByAltText("Acme Knowledge")).toBeTruthy();
  });

  it("has no effect without a logo image, where the name already is the logo", () => {
    applyBranding({ name: "Acme Knowledge", logo: { showName: true } });
    const { container } = render(<Logo />);
    expect(container.textContent).toBe("Acme Knowledge");
  });
});
