import { defineModule } from "@kb/module-sdk";
import { DocumentDetail } from "./DocumentDetail.tsx";
import { DocumentList } from "./DocumentList.tsx";
import manifest from "./manifest.ts";
import { Search } from "./Search.tsx";

export default defineModule({
  ...manifest,
  routes: [
    { index: true, element: <DocumentList /> },
    { path: "search", element: <Search /> },
    { path: ":id", element: <DocumentDetail /> },
  ],
});
