import type { KbModule, RuntimeConfig } from "@kb/module-sdk";
import { modules } from "./modules.gen.ts";

/** Compiled-in modules, filtered by the runtime config. */
export function activeModules(config: RuntimeConfig): KbModule[] {
  const enabled = config.enabledModules;
  return enabled ? modules.filter((m) => enabled.includes(m.id)) : modules;
}
