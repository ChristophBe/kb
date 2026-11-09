import type { SearchHit, SearchProvider } from "@kb/module-sdk";
import { headingSlug } from "@kb/ui";
import { type ManualPage, manualPages } from "./manual.ts";

/** How many sections the global search lists at most. */
export const HELP_SEARCH_LIMIT = 20;
/** How many characters of text a snippet shows around the match. */
const SNIPPET_CHARS = 140;

/** One searchable part of the manual: a page's intro or one of its sections. */
export interface ManualSection {
  page: ManualPage;
  /** The section heading as plain text; empty for the text before the first one. */
  heading: string;
  /** The section's text as plain text, without Markdown syntax. */
  text: string;
  href: string;
}

/**
 * Markdown inline and block syntax removed, whitespace collapsed:
 * "Select **Rename** ([more](#x))" becomes "Select Rename (more)".
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^```.*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|\*|`|~~)/g, "")
    .replace(/(^|\s)_(\S[^_]*)_(?=\s|[.,;:!?)]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** A page split at its h2 and h3 headings; the h1 is the page itself. */
export function pageSections(page: ManualPage): ManualSection[] {
  const sections: ManualSection[] = [];
  let heading = "";
  let lines: string[] = [];
  const flush = () => {
    const text = plainText(lines.join("\n"));
    if (heading || text) {
      const hash = heading ? `#${headingSlug(heading)}` : "";
      sections.push({ page, heading, text, href: `/help/${page.slug}${hash}` });
    }
  };
  let fenced = false;
  for (const line of page.markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const h = fenced ? null : /^(#{1,3}) (.+)$/.exec(line);
    if (!h) {
      lines.push(line);
      continue;
    }
    flush();
    heading = h[1] === "#" ? "" : plainText(h[2] ?? "");
    lines = [];
  }
  flush();
  return sections;
}

const sections = manualPages.flatMap(pageSections);

/** About SNIPPET_CHARS characters of `text` around `at`, cut at word boundaries. */
function excerpt(text: string, at: number): string {
  if (text.length <= SNIPPET_CHARS) return text;
  let start = Math.max(0, at - SNIPPET_CHARS / 3);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  let end = Math.min(text.length, start + SNIPPET_CHARS);
  const space = text.lastIndexOf(" ", end);
  if (end < text.length && space > start) end = space;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * The shell's "Help" group: sections of the user manual whose heading or text
 * contains every word of the query, ignoring case. Heading matches come first,
 * then text matches, each in manual order; the snippet names the page and shows
 * the matching text.
 */
export const helpProvider: SearchProvider = {
  label: "Help",
  search: async (query) => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const inHeading: SearchHit[] = [];
    const inText: SearchHit[] = [];
    for (const s of sections) {
      const heading = s.heading.toLowerCase();
      const text = s.text.toLowerCase();
      const all = `${heading} ${text}`;
      if (!words.every((w) => all.includes(w))) continue;
      const headingHit = words.every((w) => heading.includes(w));
      const at = text.indexOf(words.find((w) => text.includes(w)) ?? "");
      const shown = headingHit || at < 0 ? excerpt(s.text, 0) : excerpt(s.text, at);
      const hit = {
        title: s.heading || s.page.title,
        snippet: shown ? `${s.page.title} · ${shown}` : s.page.title,
        href: s.href,
      };
      (headingHit ? inHeading : inText).push(hit);
    }
    return [...inHeading, ...inText].slice(0, HELP_SEARCH_LIMIT);
  },
};
