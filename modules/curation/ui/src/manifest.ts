import { defineManifest } from "@knowcel/module-sdk";
import { CheckCircle2 } from "@knowcel/ui";

export default defineManifest({
  id: "curation",
  title: "Document checks",
  order: 25,
  icon: CheckCircle2,
  // What the module adds to the document pages; the components load when a page shows them.
  slots: [
    {
      slot: "document.detail.actions",
      load: () => import("./lifecycle/LifecycleAction.tsx"),
      order: 10,
    },
    {
      slot: "document.detail.sections",
      load: () => import("./lifecycle/LifecycleHistory.tsx"),
    },
    {
      slot: "document.list.badges",
      load: () => import("./lifecycle/LifecycleBadge.tsx"),
    },
  ],
});
