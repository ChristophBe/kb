import { defineManifest, lazySearch } from "@kb/module-sdk";
import { FileText, Search as SearchIcon } from "lucide-react";
import { lazy } from "react";

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
  // Home-page widgets load as their own chunks, not with the module's pages.
  widgets: {
    recent: lazy(() =>
      import("./RecentDocuments.tsx").then((m) => ({ default: m.RecentDocuments })),
    ),
  },
  search: lazySearch("Documents", () =>
    import("./searchProvider.ts").then((m) => m.documentSearch),
  ),
});
