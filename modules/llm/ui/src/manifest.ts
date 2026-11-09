import { defineManifest } from "@kb/module-sdk";
import { Cpu } from "lucide-react";
import { lazy } from "react";

export default defineManifest({
  id: "llm",
  title: "Models",
  icon: Cpu,
  feature: {
    headline: "See what powers answers",
    description:
      "Check the providers' health and which models write answers and index your documents.",
    cta: { label: "View models", path: "" },
  },
  // Home-page widgets load as their own chunks, not with the module's pages.
  widgets: {
    status: lazy(() => import("./ProviderStatus.tsx").then((m) => ({ default: m.ProviderStatus }))),
  },
});
