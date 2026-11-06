// The user manual in docs/user-manual, bundled at build time: edits show up after
// a rebuild, with no copy kept here.
const files = import.meta.glob<string>("../../../../docs/user-manual/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface ManualPage {
  /** The file name without ".md"; the page's address is /help/<slug>. */
  slug: string;
  title: string;
  summary: string;
  markdown: string;
}

const README = "README";

function fileSlug(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

const sources = new Map(Object.entries(files).map(([path, md]) => [fileSlug(path), md]));

/** "- [Title](file.md) — summary" lines of the README's Index section. */
function parseIndex(readme: string): { slug: string; title: string; summary: string }[] {
  const index = readme.split(/^## Index\s*$/m)[1] ?? "";
  return [...index.matchAll(/^- \[([^\]]+)\]\(([\w-]+)\.md\)\s*(?:—\s*(.*))?$/gm)].map((m) => ({
    title: m[1] ?? "",
    slug: m[2] ?? "",
    summary: m[3]?.trim() ?? "",
  }));
}

function h1(markdown: string): string | undefined {
  return /^# (.+)$/m.exec(markdown)?.[1]?.trim();
}

function buildPages(): ManualPage[] {
  const listed = parseIndex(sources.get(README) ?? "").filter((p) => sources.has(p.slug));
  // Pages missing from the index still get listed, after the indexed ones.
  const unlisted = [...sources.keys()]
    .filter((slug) => slug !== README && !listed.some((p) => p.slug === slug))
    .sort()
    .map((slug) => ({ slug, title: h1(sources.get(slug) ?? "") ?? slug, summary: "" }));
  return [...listed, ...unlisted].map((p) => ({ ...p, markdown: sources.get(p.slug) ?? "" }));
}

/** The manual's pages in index order; the README (contributor rules) isn't one. */
export const manualPages: ManualPage[] = buildPages();

/**
 * Where a link inside the manual leads in the app: "chat.md#stop-an-answer"
 * becomes "/help/chat#stop-an-answer"; links that aren't to a manual page stay
 * as they are.
 */
export function helpHref(href: string): string {
  const m = /^(?:\.\/)?([\w-]+)\.md(#.*)?$/.exec(href);
  if (!m) return href;
  const page = m[1] === README ? "" : `/${m[1]}`;
  return `/help${page}${m[2] ?? ""}`;
}
