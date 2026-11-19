import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A page that fills the viewport must use `page-fill` (platform/ui/kit/src/theme.css): it leaves
// the room the shell keeps for the top bar and the "Powered by" credit of a branded deployment.
// Sizing a page with dvh or h-screen puts the credit below the fold (#371).
const root = join(import.meta.dirname, "..", "..", "..");

/** The shell and the kit size the viewport themselves: the layout, the sign-in page and `Area`. */
const ALLOWED_FILES = new Set([
  join("apps", "web", "src", "App.tsx"),
  join("apps", "web", "src", "auth", "AuthGate.tsx"),
  join("platform", "ui", "kit", "src", "components.tsx"),
]);

const VIEWPORT_HEIGHT = /\b(?:[\w-]+:)*(?:min-|max-)?h-(?:screen|dvh|svh|lvh)\b|\b\d*d?vh\b|dvh/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "dist") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function roots(): string[] {
  const modules = readdirSync(join(root, "modules")).map((m) => join(root, "modules", m, "ui"));
  return [join(root, "apps/web/src"), join(root, "platform/ui"), ...modules].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

describe("full-height pages", () => {
  it("use page-fill instead of sizing themselves by the viewport", () => {
    const offenders = roots()
      .flatMap(sources)
      .filter((file) => !ALLOWED_FILES.has(relative(root, file)))
      .filter((file) => VIEWPORT_HEIGHT.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split(sep).join("/"));
    expect(offenders, "use the page-fill class (docs/ux-standards.md)").toEqual([]);
  });

  it("is checked against a page that does it wrong", () => {
    expect(VIEWPORT_HEIGHT.test('className="h-[calc(100dvh-3.5rem)] md:h-dvh"')).toBe(true);
    expect(VIEWPORT_HEIGHT.test('className="min-h-screen"')).toBe(true);
    expect(VIEWPORT_HEIGHT.test('className="page-fill flex"')).toBe(false);
  });
});
