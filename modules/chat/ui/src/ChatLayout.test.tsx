import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  ChatService,
  type Conversation,
  ConversationSchema,
  MessageRole,
} from "@kb/chat-api/kb/chat/v1/chat_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { polyfillDialog } from "@kb/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import chat from "./index.tsx";

// jsdom has no layout; the conversation scrolls to its newest message.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
beforeAll(polyfillDialog);

const conversation = (id: string, title: string) => create(ConversationSchema, { id, title });

/** A chat service backed by an in-memory list of conversations. */
// `listDelay` slows the list down, as a real network does, so a redirect from a
// stale list shows.
function chatService(initial: Conversation[], listDelay = 0) {
  let conversations = initial;
  const deleteConversation = vi.fn(({ id }: { id: string }) => {
    conversations = conversations.filter((c) => c.id !== id);
    return {};
  });
  const transport = createRouterTransport(({ service }) =>
    service(ChatService, {
      listConversations: async () => {
        await new Promise((resolve) => setTimeout(resolve, listDelay));
        return { conversations };
      },
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

const sidebar = () => within(screen.getByRole("navigation", { name: "Conversations" }));

/** Opens the delete confirmation from the entry's button, as a user would. */
async function askToDelete(title: string) {
  const button = await screen.findByRole("button", { name: `Delete conversation ${title}` });
  button.focus();
  fireEvent.click(button);
  return button;
}

describe("ChatLayout", () => {
  it("lists the conversations, untitled ones as new", async () => {
    const { transport } = chatService([conversation("c1", "Q3 revenue"), conversation("c2", "")]);
    renderModule(chat, transport);
    const link = await screen.findByRole("link", { name: "Q3 revenue" });
    expect(link.getAttribute("href")).toBe("/c1");
    expect(sidebar().getByRole("link", { name: "New conversation" }).getAttribute("href")).toBe(
      "/c2",
    );
  });

  it("opens the most recent conversation in place of the start page", async () => {
    const { transport } = chatService([
      conversation("c1", "Q3 revenue"),
      conversation("c2", "Hiring plan"),
    ]);
    const { router } = renderModule(chat, transport);
    expect(await screen.findByText("How did revenue develop?")).toBeTruthy();
    expect(sidebar().getByRole("link", { name: "Q3 revenue" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(router.state.location.pathname).toBe("/c1");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("shows the start page when there are no conversations", async () => {
    const { transport } = chatService([]);
    const { router } = renderModule(chat, transport);
    expect(await screen.findByText("Start a new chat.")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
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

  it("deletes a conversation after confirming and opens the next most recent", async () => {
    const { transport, deleteConversation } = chatService(
      [conversation("c1", "Q3 revenue"), conversation("c2", "Hiring plan")],
      20,
    );
    renderModule(chat, transport, "/c1");
    await screen.findByText("How did revenue develop?");
    await askToDelete("Q3 revenue");
    const dialog = within(screen.getByRole("dialog", { name: "Delete conversation?" }));
    expect(dialog.getByText(/“Q3 revenue” and all its messages will be deleted/)).toBeTruthy();
    expect(deleteConversation).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
    const next = await sidebar().findByRole("link", { name: "Hiring plan", current: "page" });
    expect(next).toBeTruthy();
    expect(deleteConversation.mock.calls[0]?.[0].id).toBe("c1");
    expect(screen.queryByRole("link", { name: "Q3 revenue" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("navigation", { name: "Conversations" }));
  });

  it("stays on the open conversation when deleting another one", async () => {
    const { transport } = chatService([
      conversation("c1", "Q3 revenue"),
      conversation("c2", "Hiring plan"),
    ]);
    renderModule(chat, transport, "/c1");
    await screen.findByText("How did revenue develop?");
    await askToDelete("Hiring plan");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Hiring plan" })).toBeNull());
    expect(sidebar().getByRole("link", { name: "Q3 revenue", current: "page" })).toBeTruthy();
  });

  it("keeps the conversation when the deletion is cancelled", async () => {
    const { transport, deleteConversation } = chatService([conversation("c1", "Q3 revenue")]);
    renderModule(chat, transport, "/c1");
    await screen.findByText("How did revenue develop?");
    const button = await askToDelete("Q3 revenue");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(sidebar().getByRole("link", { name: "Q3 revenue" })).toBeTruthy();
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
