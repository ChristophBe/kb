import { defineModule } from "@kb/module-sdk";
import { FileText, Search as SearchIcon } from "lucide-react";
import { DocumentDetail } from "./DocumentDetail.tsx";
import { DocumentList } from "./DocumentList.tsx";
import { RecentDocuments } from "./RecentDocuments.tsx";
import { Search } from "./Search.tsx";

export default defineModule({
  id: "document",
  title: "Documents",
  icon: FileText,
  feature: {
    headline: "Search by meaning",
    description: "Find the passage you need, even when you don't remember the exact words.",
    cta: { label: "Search documents", path: "search" },
    search: "search",
  },
  widgets: { recent: RecentDocuments },
  routes: [
    { index: true, element: <DocumentList /> },
    { path: "search", element: <Search /> },
    { path: ":id", element: <DocumentDetail /> },
  ],
  nav: [
    { path: "", label: "Documents", icon: FileText },
    { path: "search", label: "Search", icon: SearchIcon },
  ],
});
