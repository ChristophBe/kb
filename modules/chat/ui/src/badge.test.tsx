import { create } from "@bufbuild/protobuf";
import {
  ConversationSchema,
  ListConversationsResponseSchema,
} from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { KbRuntimeProvider } from "@knowcel/module-sdk";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnseenAnswers } from "./badge.ts";

const listConversations = vi.fn();

vi.mock("@knowcel/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@knowcel/module-sdk")>()),
  useClient: () => ({ listConversations }),
}));

function respond(...conversations: Parameters<typeof create<typeof ConversationSchema>>[1][]) {
  listConversations.mockResolvedValue(
    create(ListConversationsResponseSchema, {
      conversations: conversations.map((c) => create(ConversationSchema, c)),
    }),
  );
}

function Badge() {
  return <p>unseen: {useUnseenAnswers()}</p>;
}

function renderBadge() {
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <MemoryRouter>
        <Badge />
      </MemoryRouter>
    </KbRuntimeProvider>,
  );
}

function stubNotification(permission: NotificationPermission) {
  const shown: string[] = [];
  class Fake {
    static permission = permission;
    onclick: (() => void) | null = null;
    constructor(title: string) {
      shown.push(title);
    }
    close() {}
  }
  vi.stubGlobal("Notification", Fake);
  return shown;
}

describe("useUnseenAnswers", () => {
  beforeEach(() => {
    listConversations.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("counts the conversations whose answer finished while away", async () => {
    respond({ id: "a", completedUnseen: true }, { id: "b" }, { id: "c", completedUnseen: true });
    renderBadge();
    expect(await screen.findByText("unseen: 2")).toBeTruthy();
  });

  it("is 0 while nothing waits, and does not look again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    respond({ id: "a" });
    renderBadge();
    expect(await screen.findByText("unseen: 0")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(listConversations).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("looks again while an answer is written and notifies when it finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const shown = stubNotification("granted");
    respond({ id: "a", title: "Budget", generating: true });
    renderBadge();
    expect(await screen.findByText("unseen: 0")).toBeTruthy();

    respond({ id: "a", title: "Budget", completedUnseen: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(await screen.findByText("unseen: 1")).toBeTruthy();
    expect(shown).toEqual(["Budget"]);
    vi.useRealTimers();
  });

  it("does not notify about what was already waiting when the app opened", async () => {
    const shown = stubNotification("granted");
    respond({ id: "a", title: "Old", completedUnseen: true });
    renderBadge();
    expect(await screen.findByText("unseen: 1")).toBeTruthy();
    expect(shown).toEqual([]);
  });
});
