/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyBranding,
  appVersion,
  brandText,
  getBranding,
  isBranded,
  productName,
} from "./branding.ts";

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

describe("applyBranding page colors", () => {
  const light = { canvas: "#f2f5fb", surface: "#fbfcff", text: "#16203a", textMuted: "#4a5878" };

  it("sets the page colors of a mode and keeps the theme's for the other", () => {
    applyBranding({ colors: { light: { ...light, border: "#d3daea", borderStrong: "#6b7a99" } } });
    expect(style()).toContain("--color-canvas: light-dark(#f2f5fb, var(--color-stone-900))");
    expect(style()).toContain("--color-surface: light-dark(#fbfcff, var(--color-stone-850))");
    expect(style()).toContain("--color-fg: light-dark(#16203a, var(--color-stone-150))");
    expect(style()).toContain("--color-fg-muted: light-dark(#4a5878, var(--color-stone-400))");
    expect(style()).toContain("--color-border: light-dark(#d3daea, var(--color-stone-700))");
    expect(style()).toContain("--color-border-strong: light-dark(#6b7a99, var(--color-stone-500))");
  });

  it("leaves the accent alone when only page colors are set", () => {
    applyBranding({ colors: { dark: { canvas: "#0c101c" } } });
    expect(style()).toContain("--color-canvas: light-dark(var(--color-stone-100), #0c101c)");
    expect(style()).not.toContain("--color-accent:");
    expect(style()).not.toContain("--color-glass");
    expect(style()).not.toContain("--color-glow");
    expect(style()).not.toContain("--color-surface-muted");
  });

  it("emits only the roles of keys that are set", () => {
    applyBranding({ colors: { light: { accent: "#1d4ed8" } } });
    expect(style()).not.toContain("--color-canvas:");
    expect(style()).not.toContain("--color-on-accent");
    expect(style()).not.toContain("--color-accent-2");
  });

  it("sets the second stop of the hero gradient", () => {
    applyBranding({ colors: { light: { accent2: "#0e7490" }, dark: { accent2: "#67c5e0" } } });
    expect(style()).toContain("--color-accent-2: light-dark(#0e7490, #67c5e0)");
  });

  it("mixes the muted surface from the surface and the text", () => {
    applyBranding({ colors: { light } });
    expect(style()).toContain(
      "--color-surface-muted: light-dark(color-mix(in oklab, #fbfcff, #16203a 8%), var(--color-stone-750))",
    );
    applyBranding({ colors: { dark: { text: "#ffffff" } } });
    expect(style()).toContain("color-mix(in oklab, var(--color-stone-850), #ffffff 8%)");
  });

  it("sets the glows at the opacity of the theme, per mode", () => {
    applyBranding({
      colors: {
        light: { glow1: "#1d4ed8", glow2: "#0e7490" },
        dark: { glow1: "#93b4ff", glow2: "#67c5e0" },
      },
    });
    expect(style()).toContain(
      "--color-glow-1: light-dark(color-mix(in srgb, #1d4ed8 10%, transparent), color-mix(in srgb, #93b4ff 10%, transparent))",
    );
    expect(style()).toContain(
      "--color-glow-2: light-dark(color-mix(in srgb, #0e7490 10%, transparent), color-mix(in srgb, #67c5e0 8%, transparent))",
    );
  });

  it("turns a glow off with none and keeps the other light", () => {
    applyBranding({ colors: { light: { glow1: "none" } } });
    expect(style()).toContain("--color-glow-1: light-dark(transparent, rgb(140 200 160 / 0.1))");
    expect(style()).not.toContain("--color-glow-2");
  });

  it("makes the glass follow the surface where the browser blurs and the user allows it", () => {
    applyBranding({ colors: { light: { surface: "#fbfcff" } } });
    const css = style();
    expect(css).toContain("@supports (backdrop-filter: blur(1px))");
    expect(css).toContain("@media not (prefers-reduced-transparency: reduce)");
    expect(css).toContain(
      "--color-glass: light-dark(color-mix(in srgb, #fbfcff 72%, transparent), rgb(25 26 23 / 0.72))",
    );
    expect(css).toContain("--color-glass-strong: light-dark(color-mix(in srgb, #fbfcff 86%");
    expect(css).toContain("--color-glass-subtle: light-dark(color-mix(in srgb, #fbfcff 40%");
    // The opaque fallbacks of theme.css stay in charge outside that condition.
    expect(css.indexOf("--color-glass:")).toBeGreaterThan(css.indexOf("@supports"));
  });

  it("keeps focus on the accent", () => {
    applyBranding({ colors: { dark: { canvas: "#0c101c" } } });
    expect(style()).toContain("--color-focus: var(--color-accent)");
  });

  it("falls back to the literal colours of theme.css for a mode left out", () => {
    const theme = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");
    const keys = { surface: "#fbfcff", glow1: "#1d4ed8", glow2: "#0e7490" };
    for (const colors of [{ light: keys }, { dark: keys }]) {
      applyBranding({ colors });
      const literals = style().match(/rgb\([^)]*\)/g) ?? [];
      expect(literals).toHaveLength(5); // three glass fills, two glows
      for (const literal of literals) expect(theme).toContain(literal);
    }
  });
});

describe("applyBranding fonts", () => {
  it("leaves the typefaces alone without fonts", () => {
    applyBranding({ name: "Acme" });
    expect(document.getElementById("knowcel-branding")).toBeNull();
  });

  it("loads a font file and puts its family before the Knowcelium typeface", () => {
    applyBranding({
      fonts: { heading: { family: "Acme Serif", file: "/branding/acme.woff2", weight: "100 900" } },
    });
    expect(style()).toContain(
      '@font-face { font-family: "Acme Serif"; src: url("/branding/acme.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }',
    );
    expect(style()).toContain(
      '--font-serif: "Acme Serif", "Source Serif 4 Variable", ui-serif, Georgia, serif;',
    );
    expect(style()).not.toContain("--font-sans");
  });

  it("uses a system font without a file and weight 400 by default", () => {
    applyBranding({
      fonts: { body: { family: "Inter" }, mono: { family: "Acme Mono", file: "/branding/m.woff" } },
    });
    expect(style()).toContain('--font-sans: "Inter", "IBM Plex Sans Variable"');
    expect(style()).toContain('--font-mono: "Acme Mono", "IBM Plex Mono"');
    expect(style()).toContain('format("woff"); font-weight: 400;');
    expect(style()).not.toContain('font-family: "Inter"; src');
  });

  it("drops quotes and backslashes from a family name", () => {
    applyBranding({ fonts: { body: { family: 'In"ter\\' } } });
    expect(style()).toContain('--font-sans: "Inter",');
  });

  it("combines with the colours in one style element", () => {
    applyBranding({
      colors: { light: { accent: "#111111", onAccent: "#ffffff" } },
      fonts: { body: { family: "Inter" } },
    });
    expect(document.querySelectorAll("#knowcel-branding")).toHaveLength(1);
    expect(style()).toContain("--color-accent");
    expect(style()).toContain("--font-sans");
  });
  // --- navigation ---
  describe("navigation", () => {
    it("paints a solid color as a gradient layer of the mode it is for", () => {
      applyBranding({ navigation: { light: { background: "#1d4ed8" } } });
      expect(style()).toContain(
        "--navigation-background: linear-gradient(180deg, light-dark(#1d4ed8, transparent), light-dark(#1d4ed8, transparent));",
      );
      expect(style()).not.toContain("--navigation-fg");
    });

    it("runs a gradient top to bottom unless an angle is given", () => {
      applyBranding({
        navigation: {
          light: { background: { from: "#ffffff", to: "#dbeafe" } },
          dark: { background: { from: "#0b1220", to: "#1e3a8a", angle: 90 } },
        },
      });
      expect(style()).toContain(
        "linear-gradient(180deg, light-dark(#ffffff, transparent), light-dark(#dbeafe, transparent)), linear-gradient(90deg, light-dark(transparent, #0b1220), light-dark(transparent, #1e3a8a))",
      );
    });

    it("sets the text token and tints the fills from it; a mode without text keeps the theme's", () => {
      applyBranding({ navigation: { dark: { background: "#0b1220", text: "#ffffff" } } });
      expect(style()).toContain("--navigation-fg: light-dark(var(--color-stone-800), #ffffff);");
      expect(style()).toContain(
        "--navigation-hover: light-dark(var(--color-surface-muted), color-mix(in oklab, #ffffff 12%, transparent));",
      );
    });

    it("is removed without branding and combines with the colors in one style element", () => {
      applyBranding({
        colors: { light: { accent: "#111111", onAccent: "#ffffff" } },
        navigation: { light: { background: "#eeeeee" } },
      });
      expect(document.querySelectorAll("#knowcel-branding")).toHaveLength(1);
      expect(style()).toContain("--color-accent");
      expect(style()).toContain("--navigation-background");
      applyBranding(undefined);
      expect(document.getElementById("knowcel-branding")).toBeNull();
    });
  });
  // --- end navigation ---
});

// --- product name everywhere (#360) ---
describe("brandText", () => {
  it("is the identity without branding", () => {
    applyBranding(undefined);
    expect(brandText("Search Knowcelium / knowcelium")).toBe("Search Knowcelium / knowcelium");
  });

  it("is the identity with a branding file that sets no name", () => {
    applyBranding({ colors: { light: { accent: "#1d4ed8", onAccent: "#ffffff" } } });
    expect(brandText("Knowcelium")).toBe("Knowcelium");
  });

  it("replaces the name in every spelling, possessives included", () => {
    applyBranding({ name: "Acme Knowledge" });
    expect(brandText("Knowcelium's manual: knowcelium / help, KNOWCELIUM")).toBe(
      "Acme Knowledge's manual: Acme Knowledge / help, Acme Knowledge",
    );
  });

  it("does not treat $ in the name as a replacement pattern", () => {
    applyBranding({ name: "A$&B" });
    expect(brandText("Knowcelium")).toBe("A$&B");
  });
});

describe("branded deployments", () => {
  it("knows whether a branding file is active, even an empty one, and the build version", () => {
    applyBranding(undefined);
    expect([isBranded(), appVersion()]).toEqual([false, "dev"]);
    applyBranding({}, "1.2.3");
    expect([isBranded(), appVersion()]).toEqual([true, "1.2.3"]);
  });
});
