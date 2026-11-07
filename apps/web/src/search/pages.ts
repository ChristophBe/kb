import type { KbModule, SearchHit, SearchProvider } from "@kb/module-sdk";
import { navEntries } from "../registry.ts";

/**
 * The shell's own search group: the pages in the sidebar (the modules' nav
 * items, then Help), matched by their label. Labels that start with the query
 * come first.
 */
export function pagesProvider(modules: KbModule[]): SearchProvider {
  const pages: SearchHit[] = [
    { title: "Home", href: "/" },
    ...navEntries(modules).map(({ to, label }) => {
      const module = modules.find((m) => to === `/m/${m.id}` || to.startsWith(`/m/${m.id}/`));
      return {
        title: label,
        href: to,
        // "Search" alone is ambiguous; say which area it belongs to.
        ...(module && module.title !== label ? { snippet: module.title } : {}),
      };
    }),
    { title: "Help", href: "/help" },
  ];
  return {
    label: "Pages",
    search: async (query) => {
      const q = query.trim().toLowerCase();
      const matches = pages.filter((p) => p.title.toLowerCase().includes(q));
      const starts = (p: SearchHit) => p.title.toLowerCase().startsWith(q);
      return [...matches.filter(starts), ...matches.filter((p) => !starts(p))];
    },
  };
}

/** The global search's groups: the shell's pages first, then each module's provider. */
export function searchProviders(modules: KbModule[]): SearchProvider[] {
  return [pagesProvider(modules), ...modules.flatMap((m) => (m.search ? [m.search] : []))];
}
