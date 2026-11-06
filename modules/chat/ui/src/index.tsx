import { defineModule } from "@kb/module-sdk";
import { MessageSquare } from "lucide-react";
import { ChatIndex, ChatLayout } from "./ChatLayout.tsx";
import { Conversation } from "./Conversation.tsx";

export default defineModule({
  id: "chat",
  title: "Chat",
  icon: MessageSquare,
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
