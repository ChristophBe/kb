import type { ComponentType } from "react";
import type { RouteObject } from "react-router";

export interface NavItem {
  /** Path relative to the module root, e.g. "" or "settings". */
  path: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/**
 * The contract every UI module implements. Module packages default-export a
 * KbModule; the shell mounts its routes under /m/<id> and lists its nav items.
 */
export interface KbModule {
  /** Matches the id in the module's module.yaml. */
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  /** Routes relative to /m/<id>. */
  routes: RouteObject[];
  /** Sidebar entries; defaults to a single entry for the module root. */
  nav?: NavItem[];
  /** Optional components the shell renders on the home dashboard. */
  widgets?: Record<string, ComponentType>;
}

export function defineModule(module: KbModule): KbModule {
  return module;
}
