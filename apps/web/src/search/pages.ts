import {
  lazySearch,
  type ModuleManifest,
  type SearchHit,
  type SearchProvider,
} from "@knowcel/module-sdk";
import { navEntries } from "../registry.ts";

/** The user manual's group; the manual loads with the first search, like the help pages. */
const helpProvider = lazySearch("Help", () =>
  import("../help/search.ts").then((m) => m.helpProvider.search),
);

/**
 * The shell's own search group: the pages of the app (Search, the
 * modules' nav items, then Help), matched by their label. Labels that start with the query
 * come first. Pages for platform admins are listed while `isPlatformAdmin()` is true; it
 * is read on every search, because the user is only known after the shell has started.
 */
export function pagesProvider(
  modules: ModuleManifest[],
  isPlatformAdmin: () => boolean = () => false,
): SearchProvider {
  const pagesFor = (admin: boolean): SearchHit[] => [
    { title: "Search", href: "/search" },
    ...navEntries(modules, admin).map(({ to, label }) => {
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
      const matches = pagesFor(isPlatformAdmin()).filter((p) => p.title.toLowerCase().includes(q));
      const starts = (p: SearchHit) => p.title.toLowerCase().startsWith(q);
      return [...matches.filter(starts), ...matches.filter((p) => !starts(p))];
    },
  };
}

/**
 * The global search's groups: the shell's pages first, then each module's
 * provider, then the user manual.
 */
export function searchProviders(
  modules: ModuleManifest[],
  isPlatformAdmin?: () => boolean,
): SearchProvider[] {
  return [
    pagesProvider(modules, isPlatformAdmin),
    ...modules.flatMap((m) => (m.search ? [m.search] : [])),
    helpProvider,
  ];
}
