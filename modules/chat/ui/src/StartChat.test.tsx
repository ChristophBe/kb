import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { ChatService, ConversationSchema } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import chat from "./index.tsx";

// jsdom has no layout; the conversation scrolls to its newest message.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const created = create(ConversationSchema, { id: "c9", title: "" });

function chatService({ failCreate = false } = {}) {
  const createConversation = vi.fn(() => {
    if (failCreate) throw new ConnectError("down", Code.Unavailable);
    return { conversation: created };
  });
  const streamChat = vi.fn(async function* (req: { conversationId: string; content: string }) {
    yield { event: { case: "delta" as const, value: `Answer to: ${req.content}` } };
  });
  const transport = createRouterTransport(({ service }) =>
    service(ChatService, {
      listConversations: () => ({
        conversations: createConversation.mock.calls.length ? [created] : [],
      }),
      createConversation,
      getConversation: () => ({ conversation: created, messages: [] }),
      streamChat,
    }),
  );
  return { transport, createConversation, streamChat };
}

describe("StartChat", () => {
  it("opens a new conversation and asks the question there, once", async () => {
    const { transport, createConversation, streamChat } = chatService();
    renderModule(chat, transport, "/new?q=How%20did%20revenue%20develop%3F");
    // The fake saves nothing, so the streamed answer is gone after the refetch; check the call.
    await waitFor(() => expect(streamChat).toHaveBeenCalled());
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(streamChat.mock.calls[0]?.[0]).toMatchObject({
      conversationId: "c9",
      content: "How did revenue develop?",
    });
    const nav = within(screen.getByRole("navigation"));
    const link = await nav.findByRole("link", { name: "New conversation" });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("opens an empty conversation without a question", async () => {
    const { transport, streamChat } = chatService();
    renderModule(chat, transport, "/new");
    const nav = within(screen.getByRole("navigation"));
    expect(
      (await nav.findByRole("link", { name: "New conversation" })).getAttribute("aria-current"),
    ).toBe("page");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("says chat is unavailable when the conversation can't be created", async () => {
    const { transport } = chatService({ failCreate: true });
    renderModule(chat, transport, "/new?q=hello");
    expect((await screen.findByRole("alert")).textContent).toContain("Chat is not available");
  });
});
