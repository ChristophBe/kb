import { defineModule } from "@kb/module-sdk";
import { FileText } from "lucide-react";
import { DocumentDetail } from "./DocumentDetail.tsx";
import { DocumentList } from "./DocumentList.tsx";

export default defineModule({
  id: "document",
  title: "Documents",
  icon: FileText,
  routes: [
    { index: true, element: <DocumentList /> },
    { path: ":id", element: <DocumentDetail /> },
  ],
});
