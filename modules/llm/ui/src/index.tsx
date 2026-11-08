import { defineModule } from "@kb/module-sdk";
import { Cpu } from "lucide-react";
import { Models } from "./Models.tsx";

export default defineModule({
  id: "llm",
  title: "Models",
  icon: Cpu,
  feature: {
    headline: "See what powers answers",
    description:
      "Check the providers' health and which models write answers and index your documents.",
    cta: { label: "View models", path: "" },
  },
  routes: [{ index: true, element: <Models /> }],
});
