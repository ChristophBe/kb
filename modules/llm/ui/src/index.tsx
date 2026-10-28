import { defineModule } from "@kb/module-sdk";
import { Cpu } from "lucide-react";
import { Models } from "./Models.tsx";

export default defineModule({
  id: "llm",
  title: "Models",
  icon: Cpu,
  routes: [{ index: true, element: <Models /> }],
});
