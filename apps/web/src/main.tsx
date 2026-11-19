import type { RuntimeConfig } from "@knowcel/module-sdk";
import { applyBranding, type Branding } from "@knowcel/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

/** /config.json: the runtime config plus the deployment's branding, when it has one. */
type ShellConfig = RuntimeConfig & { branding?: Branding; version?: string };

async function loadConfig(): Promise<RuntimeConfig> {
  const res = await fetch("/config.json");
  if (!res.ok) throw new Error(`failed to load /config.json: ${res.status}`);
  const config: ShellConfig = await res.json();
  applyBranding(config.branding, config.version);
  return config;
}

const root = createRoot(document.getElementById("root") as HTMLElement);
loadConfig().then(
  (config) =>
    root.render(
      <StrictMode>
        <App config={config} />
      </StrictMode>,
    ),
  (err: Error) => root.render(<pre className="p-6 text-danger">{err.message}</pre>),
);
