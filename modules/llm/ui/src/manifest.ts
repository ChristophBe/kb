import { defineManifest } from "@kb/module-sdk";
import { Cpu } from "lucide-react";

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
});
