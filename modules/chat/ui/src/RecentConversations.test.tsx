import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  ChatService,
  type Conversation,
  ConversationSchema,
} from "@kb/chat-api/kb/chat/v1/chat_pb";
import { renderWidget } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecentConversations } from "./RecentConversations.tsx";

function service(listConversations: () => { conversations: Conversation[] }) {
  return createRouterTransport(({ service }) => service(ChatService, { listConversations }));
}

describe("RecentConversations", () => {
  it("links the latest conversations into the chat", async () => {
    const list = vi.fn(() => ({
      conversations: [
        create(ConversationSchema, { id: "c1", title: "Quarterly numbers" }),
        create(ConversationSchema, { id: "c2", title: "" }),
      ],
    }));
    const { container } = renderWidget(RecentConversations, service(list));
    const first = await screen.findByRole("link", { name: /Quarterly numbers/ });
    expect(first.getAttribute("href")).toBe("/m/chat/c1");
    expect(screen.getByRole("link", { name: /New conversation/ }).getAttribute("href")).toBe(
      "/m/chat/c2",
    );
    expect(screen.getByRole("link", { name: "All conversations" }).getAttribute("href")).toBe(
      "/m/chat",
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ page: expect.objectContaining({ pageSize: 5 }) }),
      expect.anything(),
    );
    await expectNoAxeViolations(container);
  });

  it("invites a first question when there are none", async () => {
    renderWidget(
      RecentConversations,
      service(() => ({ conversations: [] })),
    );
    const link = await screen.findByRole("link", { name: "Ask your first question." });
    expect(link.getAttribute("href")).toBe("/m/chat");
  });

  it("says chat is unavailable when the service is down", async () => {
    renderWidget(
      RecentConversations,
      service(() => {
        throw new ConnectError("down", Code.Unavailable);
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Chat is not available right now",
    );
  });
});
