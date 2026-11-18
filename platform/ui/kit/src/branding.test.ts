import { afterEach, describe, expect, it } from "vitest";
import { applyBranding, getBranding, productName } from "./branding.ts";

const style = () => document.getElementById("knowcel-branding")?.textContent ?? "";

afterEach(() => {
  applyBranding(undefined);
  document.head.querySelector('link[rel="icon"]')?.remove();
  document.title = "";
});

describe("applyBranding", () => {
  it("keeps the Knowcelium defaults without branding", () => {
    applyBranding(undefined);
    expect(productName()).toBe("Knowcelium");
    expect(getBranding()).toEqual({});
    expect(document.getElementById("knowcel-branding")).toBeNull();
  });

  it("sets the product name and the tab title", () => {
    applyBranding({ name: "Acme Knowledge" });
    expect(productName()).toBe("Acme Knowledge");
    expect(document.title).toBe("Acme Knowledge");
  });

  it("overrides the accent roles for both modes", () => {
    applyBranding({
      colors: {
        light: { accent: "#1d4ed8", onAccent: "#ffffff" },
        dark: { accent: "#93b4ff", onAccent: "#0b1220" },
      },
    });
    expect(style()).toContain("--color-accent: light-dark(#1d4ed8, #93b4ff)");
    expect(style()).toContain("--color-on-accent: light-dark(#ffffff, #0b1220)");
    expect(style()).toContain(
      "--color-accent-hover: light-dark(color-mix(in oklab, #1d4ed8, black 18%)",
    );
    expect(style()).toContain("color-mix(in oklab, #93b4ff, white 18%)");
    expect(style()).toContain("--color-focus: var(--color-accent)");
  });

  it("keeps the theme's colour for a mode without colours", () => {
    applyBranding({ colors: { dark: { accent: "#93b4ff", onAccent: "#0b1220" } } });
    expect(style()).toContain("--color-accent: light-dark(var(--color-sage-700), #93b4ff)");
    expect(style()).toContain("--color-on-accent: light-dark(var(--color-stone-25), #0b1220)");
  });

  it("replaces the colours when applied again and removes them without branding", () => {
    applyBranding({ colors: { light: { accent: "#111111", onAccent: "#ffffff" } } });
    applyBranding({ colors: { light: { accent: "#222222", onAccent: "#ffffff" } } });
    expect(document.querySelectorAll("#knowcel-branding")).toHaveLength(1);
    expect(style()).toContain("#222222");
    applyBranding(undefined);
    expect(document.getElementById("knowcel-branding")).toBeNull();
  });

  it("points the favicon at the branded icon, creating the link when missing", () => {
    applyBranding({ favicon: "/branding/favicon.svg" });
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(
      "/branding/favicon.svg",
    );
  });

  it("replaces the type of an existing favicon link", () => {
    document.head.insertAdjacentHTML(
      "beforeend",
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    );
    applyBranding({ favicon: "/branding/favicon.png" });
    const link = document.querySelector('link[rel="icon"]');
    expect(link?.getAttribute("type")).toBeNull();
    expect(link?.getAttribute("href")).toBe("/branding/favicon.png");
  });
});
