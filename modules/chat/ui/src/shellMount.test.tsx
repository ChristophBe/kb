import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { ChatService, ConversationSchema } from "@kb/chat-api/knowcel/chat/v1/chat_pb";
import { type KbModule, useModuleRoutes } from "@kb/module-sdk";
import { renderModule } from "@kb/module-sdk/testing";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import chat from "./index.tsx";

// jsdom has no layout; the conversation scrolls to its newest message.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const older = create(ConversationSchema, { id: "c1", title: "Older chat" });
const newer = create(ConversationSchema, { id: "c2", title: "Newer chat" });
const fresh = create(ConversationSchema, { id: "c3", title: "" });

// The module's routes under the splat route m/chat/*, as the shell mounts them (#229).
function Mounted() {
  return useModuleRoutes(chat.routes);
}

async function renderInShell(path: string) {
  let created = false;
  const transport = createRouterTransport(({ service }) =>
    service(ChatService, {
      listConversations: () => ({
        conversations: created ? [fresh, newer, older] : [newer, older],
      }),
      createConversation: () => {
        created = true;
        return { conversation: fresh };
      },
      getConversation: (req) => ({
        conversation: [fresh, newer, older].find((c) => c.id === req.id),
        messages: [],
      }),
    }),
  );
  const shell: KbModule = { ...chat, routes: [{ path: "m/chat/*", element: <Mounted /> }] };
  let result: ReturnType<typeof renderModule> | undefined;
  await act(async () => {
    result = renderModule(shell, transport, path);
  });
  return (result as ReturnType<typeof renderModule>).router;
}

describe("chat mounted under the shell's m/chat/* route", () => {
  it("opens the conversation picked in the list", async () => {
    const router = await renderInShell("/m/chat/c2");
    const nav = within(await screen.findByRole("navigation", { name: "Conversations" }));
    await act(async () => {
      fireEvent.click(await nav.findByRole("link", { name: /Older chat/ }));
    });
    expect(router.state.location.pathname).toBe("/m/chat/c1");
    expect(await screen.findByRole("heading", { name: /Older chat/ })).toBeTruthy();
  });

  it("opens the new conversation after New chat, then another one from the list", async () => {
    const router = await renderInShell("/m/chat/c2");
    await screen.findByRole("navigation", { name: "Conversations" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    });
    await screen.findByRole("link", { name: /New conversation/ });
    expect(router.state.location.pathname).toBe("/m/chat/c3");
    const nav = within(screen.getByRole("navigation", { name: "Conversations" }));
    await act(async () => {
      fireEvent.click(nav.getByRole("link", { name: /Older chat/ }));
    });
    expect(router.state.location.pathname).toBe("/m/chat/c1");
    expect(await screen.findByRole("heading", { name: /Older chat/ })).toBeTruthy();
  });
});
