import { defineManifest } from "@knowcel/module-sdk";
import { Cpu } from "lucide-react";

export default defineManifest({
  id: "llm",
  title: "Models",
  order: 60,
  icon: Cpu,
});
