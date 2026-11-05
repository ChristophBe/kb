import type { ComponentType } from "react";
import type { RouteObject } from "react-router";

export interface NavItem {
  /** Path relative to the module root, e.g. "" or "settings". */
  path: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/** How the home page presents a module: one feature tile, possibly a hero action or the search box. */
export interface Feature {
  /** Short benefit-led headline, e.g. "Search by meaning". */
  headline: string;
  /** One sentence on what it does for the user. */
  description: string;
  /** The entry point; `path` is relative to the module root, like `NavItem.path`. */
  cta: { label: string; path: string };
  /** Route (relative to the module root) that searches with `?q=`; the home search box submits there. */
  search?: string;
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
  /** How the home page showcases this module. */
  feature?: Feature;
  /**
   * Optional components the shell renders on the home page. They render
   * outside the module's routes, so their links are absolute (`/m/<id>/…`).
   */
  widgets?: Record<string, ComponentType>;
}

export function defineModule(module: KbModule): KbModule {
  return module;
}
