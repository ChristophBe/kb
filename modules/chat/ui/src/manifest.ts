import { defineManifest, lazySearch } from "@knowcel/module-sdk";
import { MessageSquare } from "lucide-react";

export default defineManifest({
  id: "chat",
  title: "Chat",
  order: 10,
  icon: MessageSquare,
  search: lazySearch("Conversations", () =>
    import("./search.ts").then((m) => m.conversationSearch),
  ),
});
