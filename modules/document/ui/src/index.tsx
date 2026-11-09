import { defineModule } from "@kb/module-sdk";
import { FileText } from "lucide-react";
import { DocumentDetail } from "./DocumentDetail.tsx";
import { DocumentList } from "./DocumentList.tsx";
import { RecentDocuments } from "./RecentDocuments.tsx";
import { Search } from "./Search.tsx";
import { documentSearch } from "./searchProvider.ts";

export default defineModule({
  id: "document",
  title: "Documents",
  icon: FileText,
  feature: {
    headline: "Search by meaning",
    description: "Find the passage you need, even when you don't remember the exact words.",
    cta: { label: "Search documents", path: "/search" },
  },
  routes: [
    { index: true, element: <DocumentList /> },
    // The shell's search page searches documents; old links lead there.
    { path: "search", element: <Search /> },
    { path: ":id", element: <DocumentDetail /> },
  ],
  search: documentSearch,
  widgets: { recent: RecentDocuments },
});
