import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { renderWidget } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentConversations } from "./RecentConversations.tsx";

describe("RecentConversations", () => {
  it("lists the latest conversations with their last message", async () => {
    const { container } = renderWidget(
      RecentConversations,
      createRouterTransport(({ service }) =>
        service(ChatService, {
          listConversations: () => ({
            conversations: [
              {
                id: "c1",
                title: "Revenue",
                lastMessagePreview: "Revenue grew by 12 %.",
                lastMessageTime: timestampFromDate(new Date(Date.now() - 5 * 60_000)),
              },
              { id: "c2", title: "", createTime: timestampFromDate(new Date()) },
            ],
          }),
        }),
      ),
    );
    const link = await screen.findByRole("link", { name: "Revenue" });
    expect(link.getAttribute("href")).toBe("/m/chat/c1");
    expect(screen.getByText("Revenue grew by 12 %.")).toBeTruthy();
    expect(screen.getByText("5 minutes ago")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New conversation" }).getAttribute("href")).toBe(
      "/m/chat/c2",
    );
    expect(screen.getByRole("link", { name: "New chat" }).getAttribute("href")).toBe("/m/chat/new");
    await expectNoAxeViolations(container);
  });

  it("says so when there are no conversations", async () => {
    renderWidget(
      RecentConversations,
      createRouterTransport(({ service }) =>
        service(ChatService, { listConversations: () => ({ conversations: [] }) }),
      ),
    );
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
  });

  it("stays calm while the service is down", async () => {
    renderWidget(
      RecentConversations,
      createRouterTransport(({ service }) =>
        service(ChatService, {
          listConversations: () => {
            throw new ConnectError("no healthy upstream", Code.Unavailable);
          },
        }),
      ),
    );
    expect(await screen.findByText("Your conversations can't be loaded right now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
