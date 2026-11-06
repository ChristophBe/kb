import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  ChatService,
  type Conversation,
  ConversationSchema,
  MessageRole,
} from "@kb/chat-api/kb/chat/v1/chat_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import chat from "./index.tsx";

// jsdom has no layout; the conversation scrolls to its newest message.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const conversation = (id: string, title: string) => create(ConversationSchema, { id, title });

/** A chat service backed by an in-memory list of conversations. */
function chatService(initial: Conversation[]) {
  let conversations = initial;
  const deleteConversation = vi.fn(({ id }: { id: string }) => {
    conversations = conversations.filter((c) => c.id !== id);
    return {};
  });
  const transport = createRouterTransport(({ service }) =>
    service(ChatService, {
      listConversations: () => ({ conversations }),
      createConversation: () => {
        const created = conversation("c9", "");
        conversations = [created, ...conversations];
        return { conversation: created };
      },
      getConversation: ({ id }) => ({
        conversation: conversations.find((c) => c.id === id),
        messages: [
          { id: "m1", role: MessageRole.USER, content: "How did revenue develop?" },
          { id: "m2", role: MessageRole.ASSISTANT, content: "It grew by **12 %**." },
        ],
      }),
      deleteConversation,
    }),
  );
  return { transport, deleteConversation };
}

const sidebar = () => within(screen.getByRole("navigation"));

describe("ChatLayout", () => {
  it("lists the conversations, untitled ones as new", async () => {
    const { transport } = chatService([conversation("c1", "Q3 revenue"), conversation("c2", "")]);
    renderModule(chat, transport);
    const link = await screen.findByRole("link", { name: "Q3 revenue" });
    expect(link.getAttribute("href")).toBe("/c1");
    expect(sidebar().getByRole("link", { name: "New conversation" }).getAttribute("href")).toBe(
      "/c2",
    );
    expect(screen.getByText("Start a new chat or pick a conversation.")).toBeTruthy();
  });

  it("shows the last message's preview and age", async () => {
    const seconds = BigInt(Math.floor(Date.now() / 1000) - 5 * 60);
    const { transport } = chatService([
      create(ConversationSchema, {
        id: "c1",
        title: "Q3 revenue",
        lastMessagePreview: "It grew by 12 %.",
        lastMessageTime: { seconds },
      }),
      conversation("c2", "Hiring plan"),
    ]);
    renderModule(chat, transport);
    const link = await screen.findByRole("link", { name: "Q3 revenue" });
    expect(link.getAttribute("aria-describedby")).toBe("c1-preview c1-age");
    expect(within(link).getByText("It grew by 12 %.")).toBeTruthy();
    const age = within(link).getByText("5 minutes ago");
    expect(age.getAttribute("title")).toBe(new Date(Number(seconds) * 1000).toLocaleString());

    const empty = sidebar().getByRole("link", { name: "Hiring plan" });
    expect(empty.textContent).toBe("Hiring plan");
    expect(empty.getAttribute("aria-describedby")).toBeNull();
  });

  it("opens a conversation with its messages", async () => {
    const { transport } = chatService([conversation("c1", "Q3 revenue")]);
    renderModule(chat, transport, "/c1");
    expect(await screen.findByText("How did revenue develop?")).toBeTruthy();
    expect(screen.getByText("12 %").tagName).toBe("STRONG");
    expect(sidebar().getByRole("link", { name: "Q3 revenue" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("starts a new chat and opens it", async () => {
    const { transport } = chatService([conversation("c1", "Q3 revenue")]);
    renderModule(chat, transport);
    await screen.findByRole("link", { name: "Q3 revenue" });
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(await screen.findByText("How did revenue develop?")).toBeTruthy();
    const created = await sidebar().findByRole("link", { name: "New conversation" });
    expect(created.getAttribute("aria-current")).toBe("page");
  });

  it("deletes a conversation", async () => {
    const { transport, deleteConversation } = chatService([
      conversation("c1", "Q3 revenue"),
      conversation("c2", "Hiring plan"),
    ]);
    renderModule(chat, transport, "/c1");
    await screen.findByText("How did revenue develop?");
    fireEvent.click(screen.getByRole("button", { name: "Delete conversation Q3 revenue" }));
    expect(await screen.findByText("Start a new chat or pick a conversation.")).toBeTruthy();
    expect(deleteConversation.mock.calls[0]?.[0].id).toBe("c1");
    expect(screen.queryByRole("link", { name: "Q3 revenue" })).toBeNull();
    expect(sidebar().getByRole("link", { name: "Hiring plan" })).toBeTruthy();
  });

  it("shows why the conversations can't be loaded", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(ChatService, {
        listConversations: () => {
          throw new ConnectError("chat service down", Code.Unavailable);
        },
      }),
    );
    renderModule(chat, transport);
    expect((await screen.findByRole("alert")).textContent).toBe("[unavailable] chat service down");
  });
});
