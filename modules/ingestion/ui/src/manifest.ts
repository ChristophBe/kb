import { defineManifest } from "@knowcel/module-sdk";
import { Upload } from "@knowcel/ui";

export default defineManifest({
  id: "ingestion",
  title: "Upload",
  order: 30,
  icon: Upload,
});
