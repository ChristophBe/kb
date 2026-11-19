import { defineModule } from "@knowcel/module-sdk";
import { Findings } from "./Findings.tsx";
import manifest from "./manifest.ts";

export default defineModule({
  ...manifest,
  routes: [{ index: true, element: <Findings /> }],
});
