import { defineModule } from "@kb/module-sdk";
import { FileText, Search as SearchIcon } from "lucide-react";
import { DocumentDetail } from "./DocumentDetail.tsx";
import { DocumentList } from "./DocumentList.tsx";
import { Search } from "./Search.tsx";

export default defineModule({
  id: "document",
  title: "Documents",
  icon: FileText,
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
