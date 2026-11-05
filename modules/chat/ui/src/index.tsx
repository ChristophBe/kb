import { defineModule } from "@kb/module-sdk";
import { MessageSquare } from "lucide-react";
import { ChatIndex, ChatLayout } from "./ChatLayout.tsx";
import { Conversation } from "./Conversation.tsx";
import { RecentConversations } from "./RecentConversations.tsx";

export default defineModule({
  id: "chat",
  title: "Chat",
  icon: MessageSquare,
  feature: {
    headline: "Ask, get cited answers",
    description:
      "Ask in plain language and get answers from your documents, with sources you can check.",
    cta: { label: "Ask a question", path: "" },
  },
  widgets: { recent: RecentConversations },
  routes: [
    {
      element: <ChatLayout />,
      children: [
        { index: true, element: <ChatIndex /> },
        { path: ":id", element: <Conversation /> },
      ],
    },
  ],
});
