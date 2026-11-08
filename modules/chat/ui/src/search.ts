import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import type { SearchProvider } from "@kb/module-sdk";
import { UNTITLED } from "./ConversationHeader.tsx";

/** How many conversations the global search asks for. */
export const SEARCH_LIMIT = 20;

/**
 * The chat module's group in the global search: conversations whose title or
 * messages contain the query, title matches first, with the matching excerpt.
 */
export const conversationSearch: SearchProvider = {
  label: "Conversations",
  search: async (query, signal, context) => {
    const { results } = await context
      .client(ChatService)
      .searchConversations({ query, limit: SEARCH_LIMIT }, { signal });
    return results.flatMap(({ conversation, snippet }) =>
      conversation
        ? [
            {
              title: conversation.title || UNTITLED,
              ...(snippet ? { snippet } : {}),
              href: `/m/chat/${conversation.id}`,
            },
          ]
        : [],
    );
  },
};
