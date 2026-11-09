import type { DescService } from "@bufbuild/protobuf";
import type { Client } from "@connectrpc/connect";
import type { ComponentType } from "react";
import type { RouteObject } from "react-router";

export interface NavItem {
  /** Path relative to the module root, e.g. "" or "settings". */
  path: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/** How the home page presents a module: one feature tile, possibly a hero action or the hero prompt. */
export interface Feature {
  /** Short benefit-led headline, e.g. "Search by meaning". */
  headline: string;
  /** One sentence on what it does for the user. */
  description: string;
  /** The entry point; `path` is relative to the module root, like `NavItem.path`. */
  cta: { label: string; path: string };
  /**
   * The home page's main input. Submitting it opens `path` (relative to the
   * module root) with the text in `?q=`. `label` names the input for screen
   * readers, `submit` is the button text. At most one module should set it.
   */
  prompt?: { path: string; label: string; placeholder: string; submit: string };
}

/** One result of a global search. */
export interface SearchHit {
  title: string;
  /** A short excerpt that shows why it matched; plain text. */
  snippet?: string;
  /** Absolute path in the app, e.g. "/m/document/<id>#chunk-3". */
  href: string;
}

/** What the shell hands every search: typed clients on the runtime's transport. */
export interface SearchContext {
  client<T extends DescService>(service: T): Client<T>;
}

/**
 * A module's contribution to the global search in the shell. The shell calls
 * every provider in parallel as the user types, aborts `signal` when the query
 * changes, shows the first five hits under `label` in the header's popup and
 * all of them on the search page, so return the best hits first and cap them
 * (around 20). A rejected promise shows an error in this group only.
 */
export interface SearchProvider {
  /** The group heading, e.g. "Documents". */
  label: string;
  search(query: string, signal: AbortSignal, context: SearchContext): Promise<SearchHit[]>;
}

/**
 * What the shell knows about a module before its code loads: enough for the
 * sidebar, the home page and the global search. A module package exports it
 * from `@kb/module-<id>/manifest` (`src/manifest.ts`). Every manifest ships in
 * the app's initial bundle, so it holds no page code: widgets come through
 * React's `lazy` and the search through `lazySearch`, so that each loads its
 * own small chunk on first use.
 */
export interface ModuleManifest {
  /** Matches the id in the module's module.yaml. */
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  /** Sidebar entries; defaults to a single entry for the module root. */
  nav?: NavItem[];
  /** How the home page showcases this module. */
  feature?: Feature;
  /**
   * Optional components the shell renders on the home page, each a
   * `lazy(() => import(...))` component. They render outside the module's
   * routes, so their links are absolute (`/m/<id>/…`).
   */
  widgets?: Record<string, ComponentType>;
  /** The module's group in the global search, usually from `lazySearch`. */
  search?: SearchProvider;
}

/**
 * The contract every UI module implements: its manifest plus its pages. Module
 * packages default-export a KbModule; the shell loads it on the first visit to
 * /m/<id> and mounts its routes there.
 */
export interface KbModule extends ModuleManifest {
  /** Routes relative to /m/<id>. */
  routes: RouteObject[];
}

/**
 * A compiled-in module as the shell sees it (`modules.gen.ts`): the manifest,
 * in the initial bundle, and the module's code, imported on demand.
 */
export interface LazyModule extends ModuleManifest {
  load(): Promise<{ default: KbModule }>;
}

export function defineManifest(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}

export function defineModule(module: KbModule): KbModule {
  return module;
}

/**
 * A search group whose code loads on the first search: `label` is known up
 * front, `load` imports the search function, typically
 * `() => import("./search.ts").then((m) => m.searchThings)`. A failed import
 * fails that search only; the next one tries again.
 */
export function lazySearch(
  label: string,
  load: () => Promise<SearchProvider["search"]>,
): SearchProvider {
  let pending: Promise<SearchProvider["search"]> | undefined;
  return {
    label,
    search: (query, signal, context) => {
      pending ??= load().catch((err: unknown) => {
        pending = undefined;
        throw err;
      });
      return pending.then((search) => search(query, signal, context));
    },
  };
}
