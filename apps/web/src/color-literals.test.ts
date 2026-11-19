import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Colours come from the role tokens of theme.css (bg-surface, text-danger, ...), so a branding file can
// change every one of them (docs/operations/branding.md). The UI source has no hex, rgb(), oklch() or
// hsl() literal, no raw palette class (bg-red-500, text-white, bg-black/30) and no `dark:` variant.
const root = join(import.meta.dirname, "..", "..", "..");

/** The theme's own literals: the fallbacks branding.ts keeps for a mode a branding file leaves out. */
const ALLOWED_FILES = new Set([join("platform", "ui", "kit", "src", "branding.ts")]);

const PALETTE = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "sage",
  "ochre",
  "river",
  "lichen",
  "clay",
  "white",
  "black",
];
const UTILITY =
  "bg|text|border|border-[xytblr]|ring|ring-offset|fill|stroke|from|to|via|divide|outline|shadow|accent|decoration|caret|placeholder";

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(|\bcolor\(/;
// `text-neutral` is the neutral status role, not the palette step: only a step number or a shade of white or black is raw.
const CLASSES = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*(?:(?:${UTILITY})-(?:${PALETTE.filter((c) => !["white", "black", "neutral"].includes(c)).join("|")})-\\d+|(?:${UTILITY})-(?:white|black|neutral-\\d+)|dark:)`,
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (["node_modules", "dist", "api"].includes(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const modules = readdirSync(join(root, "modules")).map((m) => join(root, "modules", m, "ui"));
const dirs = [join(root, "apps/web/src"), join(root, "platform/ui"), ...modules].filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});

/** Lines of `text` with a hard-coded colour; comments are skipped. */
export function hardCoded(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .filter((line) => LITERAL.test(line) || CLASSES.test(line));
}

describe("hard-coded colours", () => {
  it("are absent from the UI source outside theme.css", () => {
    const found = dirs
      .flatMap(sources)
      .map((file) => relative(root, file))
      .filter((file) => !file.endsWith("theme.css") && !ALLOWED_FILES.has(file))
      .flatMap((file) =>
        hardCoded(readFileSync(join(root, file), "utf8")).map((line) => `${file}: ${line.trim()}`),
      );
    expect(found).toEqual([]);
  });

  it("recognises what it forbids and lets the role tokens through", () => {
    for (const bad of [
      'style={{ color: "#fff" }}',
      "bg-black/30",
      "text-white",
      "bg-red-500",
      "hover:text-stone-700",
      "dark:bg-surface",
      "fill: rgb(0 0 0)",
      "bg-[oklch(50% 0.1 20)]",
    ])
      expect(hardCoded(bad), bad).toHaveLength(1);
    for (const good of [
      "bg-scrim backdrop:bg-scrim",
      "bg-neutral-subtle text-neutral",
      "text-danger bg-danger-subtle",
      "bg-accent/10 border-border-strong",
      "// #fff in a comment",
    ])
      expect(hardCoded(good), good).toEqual([]);
  });
});
