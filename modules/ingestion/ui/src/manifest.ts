import { defineManifest } from "@kb/module-sdk";
import { Upload } from "lucide-react";
import { lazy } from "react";

export default defineManifest({
  id: "ingestion",
  title: "Ingestion",
  icon: Upload,
  feature: {
    headline: "Bring in what you know",
    description: "Drop in PDFs, Markdown and text. kb splits and indexes them for you.",
    cta: { label: "Upload documents", path: "" },
  },
  // Home-page widgets load as their own chunks, not with the module's pages.
  widgets: {
    active: lazy(() => import("./ActiveJobs.tsx").then((m) => ({ default: m.ActiveJobs }))),
  },
});
