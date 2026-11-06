import { defineModule } from "@kb/module-sdk";
import { MessageSquare } from "lucide-react";
import { ChatIndex, ChatLayout } from "./ChatLayout.tsx";
import { Conversation } from "./Conversation.tsx";
import { StartChat } from "./StartChat.tsx";

export default defineModule({
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
  routes: [
    {
      element: <ChatLayout />,
      children: [
        { index: true, element: <ChatIndex /> },
        { path: "new", element: <StartChat /> },
        { path: ":id", element: <Conversation /> },
      ],
    },
  ],
});
