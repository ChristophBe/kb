// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Checks every colour pair the UX standards promise (docs/ux-standards.md)
// against WCAG 2.2 AA in light and dark mode: 4.5:1 for text (1.4.3), 3:1 for
// control boundaries and the focus ring (1.4.11). Tokens are resolved from
// theme.css against Tailwind's own palette, so a palette or token change that
// breaks a pair fails `task test`.

const TEXT = 4.5;
const UI = 3;

const tones = ["neutral", "info", "success", "warning", "danger"];

const pairs: [foreground: string, background: string, minimum: number][] = [
  ...["canvas", "surface", "surface-muted"].flatMap((bg): [string, string, number][] => [
    ["fg", bg, TEXT],
    ["fg-muted", bg, TEXT],
    ["border-strong", bg, UI],
    ["focus", bg, UI],
  ]),
  ["on-accent", "accent", TEXT],
  ["on-accent", "accent-hover", TEXT],
  ["accent", "canvas", UI],
  ["accent", "surface", UI],
  ["danger", "surface", TEXT],
  ...tones.map((tone): [string, string, number] => [tone, `${tone}-subtle`, TEXT]),
];

const require = createRequire(import.meta.url);
const theme = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
const palette = parseVars(readFileSync(require.resolve("tailwindcss/theme.css"), "utf8"));

/** Collects `--color-*: value;` declarations, last one wins. */
function parseVars(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const [, name = "", value = ""] of css.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)) {
    vars.set(name, value.trim());
  }
  return vars;
}

const darkStart = theme.indexOf("@media (prefers-color-scheme: dark)");
const modes = {
  light: parseVars(theme.slice(0, darkStart)),
  dark: new Map([...parseVars(theme.slice(0, darkStart)), ...parseVars(theme.slice(darkStart))]),
};

function resolve(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name) ?? palette.get(name);
  if (value === undefined) {
    throw new Error(`unknown colour ${name}`);
  }
  const ref = value.match(/^var\((--color-[\w-]+)\)$/)?.[1];
  return ref ? resolve(tokens, ref) : value;
}

/** Relative luminance (WCAG) of a `#rgb`/`#rrggbb` or `oklch(L% C H)` colour. */
function luminance(color: string): number {
  let rgb: [number, number, number];
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((d) => d + d).join("") : hex;
    const channel = (i: number) => {
      const c = Number.parseInt(full.slice(2 * i, 2 * i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    rgb = [channel(0), channel(1), channel(2)];
  } else {
    const m = color.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\)$/);
    if (!m) {
      throw new Error(`unsupported colour ${color}`);
    }
    const [, lightness = "", chroma = "", hue = ""] = m;
    const [l, c, h] = [Number(lightness) / 100, Number(chroma), hue === "none" ? 0 : Number(hue)];
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    // OKLab → linear sRGB, clamped to the sRGB gamut the browser renders.
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    rgb = [
      clamp(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
      clamp(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
      clamp(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
    ];
  }
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe.each(Object.entries(modes))("%s mode", (_, tokens) => {
  it.each(pairs)("%s on %s ≥ %s:1", (fg, bg, minimum) => {
    const ratio = contrast(resolve(tokens, `--color-${fg}`), resolve(tokens, `--color-${bg}`));
    expect(ratio).toBeGreaterThanOrEqual(minimum);
  });
});

it("converts known colours", () => {
  expect(contrast("#fff", "#000")).toBeCloseTo(21, 1);
  // Tailwind zinc-900 is #18181b.
  expect(contrast(resolve(modes.light, "--color-zinc-900"), "#fff")).toBeCloseTo(17.7, 0);
});
