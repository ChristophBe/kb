import { defineManifest, lazySearch } from "@kb/module-sdk";
import { FileText, Search as SearchIcon } from "lucide-react";

export default defineManifest({
  id: "document",
  title: "Documents",
  icon: FileText,
  feature: {
    headline: "Search by meaning",
    description: "Find the passage you need, even when you don't remember the exact words.",
    cta: { label: "Search documents", path: "search" },
  },
  nav: [
    { path: "", label: "Documents", icon: FileText },
    { path: "search", label: "Search", icon: SearchIcon },
  ],
  search: lazySearch("Documents", () =>
    import("./searchProvider.ts").then((m) => m.documentSearch),
  ),
});
