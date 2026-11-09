import { defineModule } from "@kb/module-sdk";
import { ChatIndex, ChatLayout } from "./ChatLayout.tsx";
import { Conversation } from "./Conversation.tsx";
import manifest from "./manifest.ts";
import { StartChat } from "./StartChat.tsx";

export default defineModule({
  ...manifest,
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
