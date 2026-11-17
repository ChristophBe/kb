import type { LazyModule, ModuleManifest, NavItem, RuntimeConfig } from "@knowcel/module-sdk";
import { modules } from "./modules.gen.ts";

/**
 * Compiled-in modules, filtered by the runtime config. Only their manifests
 * are loaded; a disabled module's code is never fetched.
 */
export function activeModules(config: RuntimeConfig): LazyModule[] {
  const enabled = config.enabledModules;
  return enabled ? modules.filter((m) => enabled.includes(m.id)) : modules;
}

export interface NavEntry {
  /** Absolute path, e.g. "/m/chat/new". */
  to: string;
  label: string;
  icon: NonNullable<NavItem["icon"]>;
  /**
   * True for a module's root entry when the module has other entries, so the
   * root doesn't stay highlighted on their pages. Otherwise the entry also
   * covers the module's subpages, e.g. /m/chat/new.
   */
  end: boolean;
  /** The item's badge hook, see `NavItem.useBadge`. */
  useBadge?: NavItem["useBadge"];
}

/**
 * The modules' pages in sidebar order (by each item's `order`, then module order): a module's nav items, or one entry
 * for the module itself when it declares none. The sidebar and the page
 * search both list these. Items that require a platform admin are left out
 * unless `isPlatformAdmin`.
 */
export function navEntries(modules: ModuleManifest[], isPlatformAdmin = false): NavEntry[] {
  return modules
    .flatMap((m) => {
      const items = m.nav ?? [{ path: "", label: m.title, icon: m.icon, order: m.order }];
      return items
        .filter((item) => isPlatformAdmin || !item.requiresPlatformAdmin)
        .map((item) => ({
          order: item.order ?? Number.POSITIVE_INFINITY,
          entry: {
            to: item.path ? `/m/${m.id}/${item.path}` : `/m/${m.id}`,
            label: item.label,
            icon: item.icon ?? m.icon,
            end: !item.path && items.length > 1,
            useBadge: item.useBadge,
          },
        }));
    })
    .sort((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1))
    .map((x) => x.entry);
}
