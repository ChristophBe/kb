import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ChatErrorCode,
  ChatErrorSchema,
  type ChatMessage,
  ChatMessageSchema,
  ConversationSchema,
  GetConversationResponseSchema,
  MessageRole,
  MessageStatus,
  type StreamChatRequest,
  type StreamChatResponse,
  StreamChatResponseSchema,
} from "@kb/chat-api/kb/chat/v1/chat_pb";
import { KbRuntimeProvider } from "@kb/module-sdk";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "./Conversation.tsx";

const getConversation = vi.fn();
const streamChat = vi.fn();

// The real runtime, except that the chat client is a fake.
vi.mock("@kb/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kb/module-sdk")>()),
  useClient: () => ({ getConversation, streamChat }),
}));

// jsdom doesn't lay out, so it has no scrollIntoView.
Element.prototype.scrollIntoView = () => {};

let saved: ChatMessage[] = [];
let nextId = 0;

function message(role: MessageRole, content: string, status = MessageStatus.COMPLETE) {
  return create(ChatMessageSchema, { id: `m${nextId++}`, role, content, status });
}

function event(value: StreamChatResponse["event"]) {
  return create(StreamChatResponseSchema, { event: value });
}

/** A stream that sends `deltas`, then fails with `reason` and saves the partial answer. */
function failingStream(deltas: string[], reason: string) {
  return async function* (req: StreamChatRequest) {
    saved.push(message(MessageRole.USER, req.content));
    for (const delta of deltas) yield event({ case: "delta", value: delta });
    yield event({
      case: "error",
      value: create(ChatErrorSchema, { code: ChatErrorCode.UNAVAILABLE, message: reason }),
    });
    const answer = message(MessageRole.ASSISTANT, deltas.join(""), MessageStatus.FAILED);
    saved.push(answer);
    yield event({ case: "message", value: answer });
  };
}

function completeStream(answer: string) {
  return async function* (req: StreamChatRequest) {
    saved.push(message(MessageRole.USER, req.content));
    yield event({ case: "delta", value: answer });
    const done = message(MessageRole.ASSISTANT, answer);
    saved.push(done);
    yield event({ case: "message", value: done });
  };
}

let conversationId = 0;

/** Renders a conversation; each test gets its own id, as the query cache is shared. */
async function renderConversation() {
  const id = `c${conversationId++}`;
  render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <MemoryRouter initialEntries={[`/${id}`]}>
        <Routes>
          <Route path=":id" element={<Conversation />} />
        </Routes>
      </MemoryRouter>
    </KbRuntimeProvider>,
  );
  await screen.findByRole("heading");
}

async function ask(question: string) {
  const composer = screen.getByPlaceholderText("Ask something…");
  fireEvent.change(composer, { target: { value: question } });
  await act(async () => {
    fireEvent.submit(composer.closest("form") as HTMLFormElement);
  });
}

describe("Conversation", () => {
  beforeEach(() => {
    saved = [];
    getConversation.mockReset();
    streamChat.mockReset();
    getConversation.mockImplementation(async ({ id }: { id: string }) =>
      create(GetConversationResponseSchema, {
        conversation: create(ConversationSchema, { id, title: "Q3" }),
        messages: [...saved],
      }),
    );
  });

  it("keeps a failed answer's text and shows the reason with Retry", async () => {
    streamChat.mockImplementation(
      failingStream(["Revenue grew"], "The Models service isn't available. Try again in a moment."),
    );
    await renderConversation();
    await ask("How did revenue develop?");

    expect(await screen.findByText("Revenue grew")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "The answer was interrupted. The Models service isn't available. Try again in a moment.",
    );

    streamChat.mockImplementation(completeStream("It grew by 12 %."));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });

    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(streamChat.mock.calls[1]?.[0]).toMatchObject({ content: "How did revenue develop?" });
    expect(await screen.findByText("It grew by 12 %.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows a reloaded failed answer without an alert, and Retry only on the newest", async () => {
    saved = [
      message(MessageRole.USER, "first"),
      message(MessageRole.ASSISTANT, "", MessageStatus.FAILED),
      message(MessageRole.USER, "second"),
      message(MessageRole.ASSISTANT, "partial", MessageStatus.FAILED),
    ];
    await renderConversation();

    const notes = await screen.findAllByText("The answer was interrupted.");
    expect(notes).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
    const retry = screen.getAllByRole("button", { name: "Retry" });
    expect(retry).toHaveLength(1);
    const newest = notes[1]?.closest(".rounded-card") as HTMLElement;
    expect(within(newest).getByRole("button", { name: "Retry" })).toBe(retry[0]);
  });

  it("shows a readable error when the chat service can't be reached", async () => {
    streamChat.mockImplementation(async function* () {
      yield* [];
      throw new ConnectError("upstream connect error", Code.Unavailable);
    });
    await renderConversation();
    await ask("Hi");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The Chat service isn't available. Try again in a moment.");
  });
});
