import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A user-visible "Knowcelium" in the UI source must go through the branding
// (`brandText` or `productName`), so a white-label deployment never mentions it
// (docs/operations/branding.md). Allowed: tests, comments, and the places below.
const root = join(import.meta.dirname, "..", "..", "..");

/** Where the default product name legitimately appears: the default logo and the theme's key migration. */
const ALLOWED_FILES = new Set([
  join("platform", "ui", "kit", "src", "branding.ts"),
  join("platform", "ui", "kit", "src", "logo.tsx"),
  join("platform", "ui", "kit", "src", "theme.ts"),
]);

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

/** The credit line is the one place a branded UI says Knowcelium. */
function withoutCredit(file: string, text: string): string {
  return file.endsWith(`${sep}App.tsx`)
    ? text.replace(/function PoweredBy[\s\S]*?\n}\n/, "")
    : text;
}

/** Lines naming the product that are not comments and are not wrapped in the branding helpers. */
export function literals(file: string, text: string): string[] {
  const lines = withoutCredit(file, text).split("\n");
  return lines.flatMap((line, i) => {
    if (!/knowcelium/i.test(line)) return [];
    if (/^\s*(\/\/|\/?\*)/.test(line)) return [];
    const near = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
    return /brandText\(|productName\(\)/.test(near) ? [] : [`${file}:${i + 1}: ${line.trim()}`];
  });
}

describe("product name literals", () => {
  it("finds user-visible ones and lets wrapped and commented ones pass", () => {
    const text = [
      "// Knowcelium in a comment",
      " * Knowcelium in a doc comment",
      'const a = "Search Knowcelium";',
      'const b = brandText("Knowcelium");',
      "const c = brandText(",
      '  "Knowcelium may have changed",',
      ");",
    ].join("\n");
    expect(literals("x.ts", text)).toEqual(['x.ts:3: const a = "Search Knowcelium";']);
  });

  it("finds none in apps/web, platform/ui and the module UIs", () => {
    const found = roots()
      .flatMap(sources)
      .filter((f) => !ALLOWED_FILES.has(relative(root, f)))
      .flatMap((f) => literals(f, readFileSync(f, "utf8")))
      .map((l) => l.replace(root + sep, ""));
    expect(found).toEqual([]);
  });
});
