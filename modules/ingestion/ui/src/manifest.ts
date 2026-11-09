import { defineManifest } from "@kb/module-sdk";
import { Upload } from "lucide-react";

export default defineManifest({
  id: "ingestion",
  title: "Ingestion",
  icon: Upload,
  feature: {
    headline: "Bring in what you know",
    description: "Drop in PDFs, Markdown and text. kb splits and indexes them for you.",
    cta: { label: "Upload documents", path: "" },
  },
});
