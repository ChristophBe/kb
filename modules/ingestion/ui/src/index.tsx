import { defineModule } from "@kb/module-sdk";
import { Upload as UploadIcon } from "lucide-react";
import { Upload } from "./Upload.tsx";

export default defineModule({
  id: "ingestion",
  title: "Ingestion",
  icon: UploadIcon,
  feature: {
    headline: "Bring in what you know",
    description: "Drop in PDFs, Markdown and text. kb splits and indexes them for you.",
    cta: { label: "Upload documents", path: "" },
  },
  routes: [{ index: true, element: <Upload /> }],
});
