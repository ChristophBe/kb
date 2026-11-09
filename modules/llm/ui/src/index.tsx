import { defineModule } from "@kb/module-sdk";
import { Models } from "./Models.tsx";
import manifest from "./manifest.ts";

export default defineModule({
  ...manifest,
  routes: [{ index: true, element: <Models /> }],
});
