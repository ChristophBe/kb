import { defineModule } from "@kb/module-sdk";
import manifest from "./manifest.ts";
import { Upload } from "./Upload.tsx";

export default defineModule({
  ...manifest,
  routes: [{ index: true, element: <Upload /> }],
});
