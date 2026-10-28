import { KbRuntimeProvider, type RuntimeConfig } from "@kb/module-sdk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

async function loadConfig(): Promise<RuntimeConfig> {
  const res = await fetch("/config.json");
  if (!res.ok) throw new Error(`failed to load /config.json: ${res.status}`);
  return res.json();
}

const root = createRoot(document.getElementById("root") as HTMLElement);
loadConfig().then(
  (config) =>
    root.render(
      <StrictMode>
        <KbRuntimeProvider config={config}>
          <App config={config} />
        </KbRuntimeProvider>
      </StrictMode>,
    ),
  (err: Error) => root.render(<pre className="p-6 text-danger">{err.message}</pre>),
);
