// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Checks every colour pair the UX standards promise (docs/ux-standards.md)
// against WCAG 2.2 AA in light and dark mode: 4.5:1 for text (1.4.3), 3:1 for
// control boundaries and the focus ring (1.4.11). Tokens are resolved from
// theme.css against Tailwind's own palette, so a palette or token change that
// breaks a pair fails `task test`. Translucent glass is composited over each
// background it floats above ("glass/canvas").

const TEXT = 4.5;
const UI = 3;

const tones = ["neutral", "info", "success", "warning", "danger"];

/** What glass chrome and overlays realistically sit on, after blur. */
const glassBackdrops = ["canvas", "surface", "accent-subtle"].flatMap((under) => [
  `glass/${under}`,
  `glass-strong/${under}`,
]);

const pairs: [foreground: string, background: string, minimum: number][] = [
  ...["canvas", "surface", "surface-muted", ...glassBackdrops].flatMap(
    (bg): [string, string, number][] => [
      ["fg", bg, TEXT],
      ["fg-muted", bg, TEXT],
      ["border-strong", bg, UI],
      ["focus", bg, UI],
    ],
  ),
  ["on-accent", "accent", TEXT],
  ["on-accent", "accent-hover", TEXT],
  ["accent", "canvas", UI],
  ["accent", "surface", UI],
  ["accent", "accent-subtle", TEXT], // active nav item, selected rows
  ["fg", "accent-subtle", TEXT], // the user's own chat messages
  ["accent", "glass/canvas", TEXT], // active nav item on the glass sidebar
  ["danger", "surface", TEXT],
  ["danger", "glass-strong/canvas", TEXT], // error toasts
  ["danger", "glass-strong/surface", TEXT],
  ...tones.map((tone): [string, string, number] => [tone, `${tone}-subtle`, TEXT]),
];

type Mode = "light" | "dark";
type Rgba = [r: number, g: number, b: number, a: number]; // gamma-encoded sRGB, 0..1

const require = createRequire(import.meta.url);
const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
const theme = parseVars(
  css.slice(css.indexOf("@theme {"), css.indexOf("\n}", css.indexOf("@theme {"))),
);
const palette = parseVars(readFileSync(require.resolve("tailwindcss/theme.css"), "utf8"));

/** Collects `--color-*: value;` declarations, last one wins. */
function parseVars(source: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const [, name = "", value = ""] of source.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)) {
    // The formatter may wrap long values across lines.
    vars.set(name, value.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim());
  }
  return vars;
}

/** Resolves a token to a concrete colour string for `mode`. */
function resolve(name: string, mode: Mode): string {
  const value = theme.get(name) ?? palette.get(name);
  if (value === undefined) {
    throw new Error(`unknown colour ${name}`);
  }
  return resolveValue(value, mode);
}

function resolveValue(value: string, mode: Mode): string {
  const both = value.match(/^light-dark\((.+),\s*(var\(--[\w-]+\)|rgb\([^)]*\))\)$/);
  if (both) {
    return resolveValue((mode === "light" ? both[1] : both[2]) ?? "", mode);
  }
  const ref = value.match(/^var\((--color-[\w-]+)\)$/)?.[1];
  return ref ? resolve(ref, mode) : value;
}

function toGamma(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Parses `#rgb`/`#rrggbb`, `rgb(r g b / a)` or `oklch(L% C H)`. */
function parse(color: string): Rgba {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((d) => d + d).join("") : hex;
    const channel = (i: number) => Number.parseInt(full.slice(2 * i, 2 * i + 2), 16) / 255;
    return [channel(0), channel(1), channel(2), 1];
  }
  const rgb = color.match(/^rgb\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
  if (rgb) {
    const [, r = "", g = "", b = "", a = "1"] = rgb;
    return [Number(r) / 255, Number(g) / 255, Number(b) / 255, Number(a)];
  }
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
  return [
    toGamma(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    toGamma(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    toGamma(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
    1,
  ];
}

/** Blends `top` over an opaque `under`, as the browser does in sRGB. */
function composite(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (under[i] ?? 0) * (1 - a)).concat(1) as Rgba;
}

/** A token, or `top/under` for a translucent token over an opaque one. */
function colour(spec: string, mode: Mode): Rgba {
  const [top = "", under] = spec.split("/");
  const c = parse(resolve(`--color-${top}`, mode));
  return under ? composite(c, colour(under, mode)) : c;
}

/** Relative luminance (WCAG) of an opaque colour. */
function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe.each(["light", "dark"] as const)("%s mode", (mode) => {
  it.each(pairs)("%s on %s ≥ %s:1", (fg, bg, minimum) => {
    expect(contrast(colour(fg, mode), colour(bg, mode))).toBeGreaterThanOrEqual(minimum);
  });
});

it("converts known colours", () => {
  expect(contrast(parse("#fff"), parse("#000"))).toBeCloseTo(21, 1);
  // Tailwind zinc-900 is #18181b.
  expect(contrast(parse(resolve("--color-zinc-900", "light")), parse("#fff"))).toBeCloseTo(17.7, 0);
  expect(composite([1, 1, 1, 0.5], [0, 0, 0, 1])).toEqual([0.5, 0.5, 0.5, 1]);
  expect(resolve("--color-canvas", "light")).toBe(resolve("--color-zinc-100", "light"));
  expect(resolve("--color-canvas", "dark")).toBe(resolve("--color-zinc-950", "dark"));
  expect(parse(resolve("--color-glass", "dark"))[3]).toBeLessThan(1);
});
