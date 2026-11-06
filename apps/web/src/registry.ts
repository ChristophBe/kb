import type { KbModule, NavItem, RuntimeConfig } from "@kb/module-sdk";
import { modules } from "./modules.gen.ts";

/** Compiled-in modules, filtered by the runtime config. */
export function activeModules(config: RuntimeConfig): KbModule[] {
  const enabled = config.enabledModules;
  return enabled ? modules.filter((m) => enabled.includes(m.id)) : modules;
}

export interface NavEntry {
  /** Absolute path, e.g. "/m/document/search". */
  to: string;
  label: string;
  icon: NonNullable<NavItem["icon"]>;
  /** True for a module root, which matches only itself when highlighting. */
  end: boolean;
}

/**
 * The modules' pages in sidebar order: a module's nav items, or one entry
 * for the module itself when it declares none. The sidebar and the Welcome
 * page both list these.
 */
export function navEntries(modules: KbModule[]): NavEntry[] {
  return modules.flatMap((m) =>
    (m.nav ?? [{ path: "", label: m.title, icon: m.icon }]).map((item) => ({
      to: item.path ? `/m/${m.id}/${item.path}` : `/m/${m.id}`,
      label: item.label,
      icon: item.icon ?? m.icon,
      end: !item.path,
    })),
  );
}
