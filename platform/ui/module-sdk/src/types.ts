import type { DescService } from "@bufbuild/protobuf";
import type { Client } from "@connectrpc/connect";
import type { ComponentType } from "react";
import type { RouteObject } from "react-router";

export interface NavItem {
  /** Path relative to the module root, e.g. "" or "settings". */
  path: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /**
   * Show the entry only to platform admins. This hides the link, it does not
   * protect the page: the module's service still has to check the role.
   */
  requiresPlatformAdmin?: boolean;
  /**
   * Position in the sidebar, lowest first. Entries without one come after all
   * ordered entries, in module order.
   */
  order?: number;
  /**
   * A React hook the sidebar calls (so it runs on every page, even before the
   * module's code loads) for a badge on the entry: the number of things that
   * wait for the user, 0 for none. It is part of the manifest, so keep it small.
   */
  useBadge?: () => number;
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
 * (around 20). A rejected promise shows an error in this group only: a
 * `SearchError`'s message as it is, otherwise a generic one.
 */
export interface SearchProvider {
  /** The group heading, e.g. "Documents". */
  label: string;
  search(query: string, signal: AbortSignal, context: SearchContext): Promise<SearchHit[]>;
}

/**
 * What the shell knows about a module before its code loads: enough for the
 * sidebar and the global search. A module package exports it
 * from `@knowcel/module-<id>/manifest` (`src/manifest.ts`). Every manifest ships in
 * the app's initial bundle, so it holds no page code: the search comes through
 * `lazySearch`, so that it loads its own small chunk on first use.
 */
export interface ModuleManifest {
  /** Matches the id in the module's module.yaml. */
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  /** Sidebar entries; defaults to a single entry for the module root. */
  nav?: NavItem[];
  /** Sidebar position of the default entry (used when `nav` is not set); see `NavItem.order`. */
  order?: number;
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
