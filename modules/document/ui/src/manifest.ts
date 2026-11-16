import { defineManifest, lazySearch } from "@knowcel/module-sdk";
import { FileText } from "lucide-react";

export default defineManifest({
  id: "document",
  title: "Documents",
  order: 20,
  icon: FileText,
  search: lazySearch("Documents", () =>
    import("./searchProvider.ts").then((m) => m.documentSearch),
  ),
});
