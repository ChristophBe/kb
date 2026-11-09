import { defineModule } from "@kb/module-sdk";
import { DocumentDetail } from "./DocumentDetail.tsx";
import { DocumentList } from "./DocumentList.tsx";
import manifest from "./manifest.ts";
import { Search } from "./Search.tsx";

export default defineModule({
  ...manifest,
  routes: [
    { index: true, element: <DocumentList /> },
    // The shell's search page searches documents; old links lead there.
    { path: "search", element: <Search /> },
    { path: ":id", element: <DocumentDetail /> },
  ],
});
