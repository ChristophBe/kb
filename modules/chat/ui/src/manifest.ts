import { defineManifest, lazySearch } from "@kb/module-sdk";
import { MessageSquare } from "lucide-react";

export default defineManifest({
  id: "chat",
  title: "Chat",
  icon: MessageSquare,
  feature: {
    headline: "Ask, get cited answers",
    description:
      "Ask in plain language and get answers from your documents, with sources you can check.",
    cta: { label: "Start a chat", path: "new" },
    prompt: {
      path: "new",
      label: "Ask a question",
      placeholder: "Ask anything about your documents…",
      submit: "Ask",
    },
  },
  search: lazySearch("Conversations", () =>
    import("./search.ts").then((m) => m.conversationSearch),
  ),
});
