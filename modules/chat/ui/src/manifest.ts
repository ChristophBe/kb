import { defineManifest, lazySearch } from "@knowcel/module-sdk";
import { MessageSquare } from "lucide-react";

export default defineManifest({
  id: "chat",
  title: "Chat",
  icon: MessageSquare,
  search: lazySearch("Conversations", () =>
    import("./search.ts").then((m) => m.conversationSearch),
  ),
});
