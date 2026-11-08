import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  ChatService,
  ConversationSchema,
  type SearchConversationsRequest,
} from "@kb/chat-api/kb/chat/v1/chat_pb";
import type { SearchContext } from "@kb/module-sdk";
import { describe, expect, it } from "vitest";
import chat from "./index.tsx";
import { conversationSearch, SEARCH_LIMIT } from "./search.ts";

function contextFor(searchConversations: ServiceImpl<typeof ChatService>["searchConversations"]) {
  const transport = createRouterTransport(({ service }) =>
    service(ChatService, { searchConversations }),
  );
  return { client: (s) => createClient(s, transport) } as SearchContext;
}

const signal = new AbortController().signal;

describe("conversationSearch", () => {
  it("is the chat module's search group", () => {
    expect(chat.search).toBe(conversationSearch);
    expect(conversationSearch.label).toBe("Conversations");
  });

  it("returns the matches in order, linking to each conversation", async () => {
    const requests: SearchConversationsRequest[] = [];
    const context = contextFor((req) => {
      requests.push(req);
      return {
        results: [
          { conversation: create(ConversationSchema, { id: "c1", title: "Lisbon trip" }) },
          {
            conversation: create(ConversationSchema, { id: "c2", title: "" }),
            snippet: "Museums in Lisbon?",
          },
        ],
      };
    });

    expect(await conversationSearch.search("lisbon", signal, context)).toEqual([
      { title: "Lisbon trip", href: "/m/chat/c1" },
      { title: "New conversation", snippet: "Museums in Lisbon?", href: "/m/chat/c2" },
    ]);
    expect(requests.map((r) => [r.query, r.limit])).toEqual([["lisbon", SEARCH_LIMIT]]);
  });

  it("rejects when the chat service fails", async () => {
    const context = contextFor(() => {
      throw new ConnectError("down", Code.Unavailable);
    });
    await expect(conversationSearch.search("x", signal, context)).rejects.toMatchObject({
      code: Code.Unavailable,
    });
  });
});
