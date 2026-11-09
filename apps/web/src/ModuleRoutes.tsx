import type { KbModule, LazyModule } from "@kb/module-sdk";
import { use } from "react";
import { useRoutes } from "react-router";
import { ModuleLoadError } from "./ModuleBoundary.tsx";

const loaded = new WeakMap<LazyModule, Promise<KbModule>>();

/**
 * The module's code, imported on the first call. Every later call gets the
 * same promise, as React's `use` needs; a failed import stays failed until
 * the page is reloaded, since its chunk is usually gone after a deploy.
 */
export function loadModule(module: LazyModule): Promise<KbModule> {
  let pending = loaded.get(module);
  if (!pending) {
    pending = module.load().then(
      (m) => m.default,
      (err: unknown) => {
        throw new ModuleLoadError(module.title, err);
      },
    );
    loaded.set(module, pending);
  }
  return pending;
}

/**
 * A module's pages under /m/<id>/*: suspends while the module's code loads
 * (the surrounding ModuleBoundary shows the loading state and any failure),
 * then renders its routes.
 */
export function ModuleRoutes({ module }: { module: LazyModule }) {
  return useRoutes(use(loadModule(module)).routes);
}
