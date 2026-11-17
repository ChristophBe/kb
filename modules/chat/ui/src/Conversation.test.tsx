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
} from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { ModelKind } from "@knowcel/llm-api/knowcel/llm/v1/llm_pb";
import { dismissToast, KbRuntimeProvider, useToasts } from "@knowcel/module-sdk";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "./Conversation.tsx";

const getConversation = vi.fn();
const streamChat = vi.fn();
const updateConversation = vi.fn(async () => ({}));
const listDocuments = vi.fn(async () => ({ documents: [] }));
const stopChat = vi.fn(async () => ({}));
// The llm module's chat models for the model picker.
const listModels = vi.fn(async () => ({
  models: [
    { id: "llama3.2", kind: ModelKind.CHAT },
    { id: "qwen2.5:0.5b", kind: ModelKind.CHAT },
  ],
}));
const getProviderStatus = vi.fn(async () => ({ defaultChatModel: "llama3.2" }));

// The real runtime, except that the chat and llm clients are fakes.
vi.mock("@knowcel/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@knowcel/module-sdk")>()),
  useClient: () => ({
    getConversation,
    streamChat,
    stopChat,
    updateConversation,
    listDocuments,
    listModels,
    getProviderStatus,
  }),
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

/** A stream that sends `deltas`, then waits until it is aborted and saves the answer as stopped. */
function stoppableStream(deltas: string[]) {
  return async function* (req: StreamChatRequest, opts: { signal: AbortSignal }) {
    saved.push(message(MessageRole.USER, req.content));
    for (const delta of deltas) yield event({ case: "delta", value: delta });
    await new Promise((resolve) => opts.signal.addEventListener("abort", resolve));
    saved.push(message(MessageRole.ASSISTANT, deltas.join(""), MessageStatus.STOPPED));
    throw new ConnectError("the operation was aborted", Code.Canceled);
  };
}

/** Stands in for the shell's toast host: shows the actions of the toasts. */
function ToastProbe() {
  return useToasts().map((t) =>
    t.action ? (
      <button key={t.id} type="button" onClick={t.action.onSelect}>
        {t.action.label}
      </button>
    ) : null,
  );
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
        <ToastProbe />
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
  beforeAll(polyfillDialog);
  beforeEach(() => {
    saved = [];
    getConversation.mockReset();
    streamChat.mockReset();
    stopChat.mockClear();
    localStorage.clear();
    for (let i = 0; i < 100; i++) dismissToast(i);
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

  it("stops a streaming answer and keeps it as stopped", async () => {
    streamChat.mockImplementation(stoppableStream(["Revenue grew"]));
    await renderConversation();
    const send = screen.getByRole("button", { name: "Ask" });
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    await ask("How did revenue develop?");

    expect(await screen.findByText("Revenue grew")).toBeTruthy();
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(send.getAttribute("aria-describedby")).toBeTruthy();
    const signal = streamChat.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    expect(signal.aborted).toBe(true);
    expect(stopChat).toHaveBeenCalledWith({ conversationId: expect.stringMatching(/^c\d+$/) });
    expect(await screen.findByText("Stopped")).toBeTruthy();
    expect(screen.getByText("Revenue grew")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Answer stopped");
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Ask something…"));
    // The saved stopped answer replaces the local one; it isn't shown twice.
    expect(screen.getAllByText("Revenue grew")).toHaveLength(1);
    expect(saved.at(-1)?.status).toBe(MessageStatus.STOPPED);
  });

  it("stops the answer with Esc in the composer", async () => {
    streamChat.mockImplementation(stoppableStream(["Half"]));
    await renderConversation();
    await ask("Question?");
    expect(await screen.findByText("Half")).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText("Ask something…"), { key: "Escape" });
    });

    expect(await screen.findByText("Stopped")).toBeTruthy();
  });

  it("only stops following the answer when the conversation is left", async () => {
    streamChat.mockImplementation(stoppableStream(["Half"]));
    await renderConversation();
    await ask("Question?");
    expect(await screen.findByText("Half")).toBeTruthy();
    const signal = streamChat.mock.calls[0]?.[1]?.signal as AbortSignal;

    cleanup();
    await act(async () => {});

    // The stream is closed, but the server isn't told to stop the answer.
    expect(signal.aborted).toBe(true);
    expect(stopChat).not.toHaveBeenCalled();
  });

  it("shows an answer that is still being written after the page is reopened", async () => {
    getConversation.mockImplementation(async ({ id }: { id: string }) =>
      create(GetConversationResponseSchema, {
        conversation: create(ConversationSchema, { id, title: "Q3", generating: true }),
        messages: [...saved],
      }),
    );
    saved = [message(MessageRole.USER, "Question?")];
    await renderConversation();

    expect(await screen.findByText("Writing the answer…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask" }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    expect(stopChat).toHaveBeenCalledOnce();
  });

  describe("notifications", () => {
    afterEach(() => vi.unstubAllGlobals());

    function stubNotification(permission: NotificationPermission) {
      const shown: string[] = [];
      const request = vi.fn(async () => "granted");
      class Fake {
        static permission = permission;
        static requestPermission = request;
        onclick: (() => void) | null = null;
        constructor(title: string) {
          shown.push(title);
        }
        close() {}
      }
      vi.stubGlobal("Notification", Fake);
      return { shown, request };
    }

    it("offers browser notifications once, on the first question", async () => {
      const { request } = stubNotification("default");
      streamChat.mockImplementation(completeStream("Fine."));
      await renderConversation();
      await ask("First?");

      const enable = await screen.findByRole("button", { name: "Enable notifications" });
      // Permission is asked for from the button, not on its own.
      expect(request).not.toHaveBeenCalled();
      fireEvent.click(enable);
      expect(request).toHaveBeenCalledOnce();
    });

    it("does not offer them again, or when they are decided or unsupported", async () => {
      stubNotification("denied");
      streamChat.mockImplementation(completeStream("Fine."));
      await renderConversation();
      await ask("First?");
      expect(screen.queryByRole("button", { name: "Enable notifications" })).toBeNull();

      vi.unstubAllGlobals();
      vi.stubGlobal("Notification", undefined);
      await ask("Second?");
      expect(screen.queryByRole("button", { name: "Enable notifications" })).toBeNull();
    });

    it("notifies about an answer that finishes while the tab is hidden", async () => {
      const { shown } = stubNotification("granted");
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      streamChat.mockImplementation(completeStream("Fine."));
      await renderConversation();
      await ask("Question?");

      expect(await screen.findByText("Fine.")).toBeTruthy();
      expect(shown).toEqual(["Q3"]);
      vi.restoreAllMocks();
    });
  });

  it("shows a reloaded stopped answer with its label and a Retry that asks the question again", async () => {
    saved = [
      message(MessageRole.USER, "first"),
      message(MessageRole.ASSISTANT, "partial", MessageStatus.STOPPED),
    ];
    await renderConversation();

    expect(await screen.findByText("partial")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.queryByText("The answer was interrupted.")).toBeNull();

    streamChat.mockImplementation(completeStream("Full answer."));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(streamChat.mock.calls[0]?.[0]).toMatchObject({ content: "first" });
  });

  it("offers Copy answer on the newest answer only, not on questions or while streaming", async () => {
    saved = [
      message(MessageRole.USER, "first"),
      message(MessageRole.ASSISTANT, "old **answer**"),
      message(MessageRole.USER, "second"),
      message(MessageRole.ASSISTANT, "new **answer**"),
    ];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderConversation();

    const copy = await screen.findAllByRole("button", { name: "Copy answer" });
    expect(copy).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await act(async () => {
      fireEvent.click(copy[0] as HTMLElement);
    });
    expect(writeText).toHaveBeenCalledWith("new **answer**");
  });

  it("keeps Sources and shows the scope, or model only once platform knowledge is off", async () => {
    streamChat.mockImplementation(completeStream("Hello."));
    await renderConversation();
    expect(screen.getByText("all documents")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /platform knowledge/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Use platform knowledge" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    expect(screen.getByText("No platform knowledge – model only")).toBeTruthy();
    expect(screen.queryByText("all documents")).toBeNull();
    expect(screen.getByRole("button", { name: "Sources" })).toBeTruthy();

    await ask("Hi");
    expect(streamChat.mock.calls[0]?.[0]).toMatchObject({ useKnowledgeBase: false });
  });

  it("answers with the model picked for the conversation", async () => {
    streamChat.mockImplementation(completeStream("Hello."));
    await renderConversation();
    await ask("Hi");
    expect(streamChat.mock.calls[0]?.[0]).toMatchObject({ model: "" });

    fireEvent.change(await screen.findByRole("combobox", { name: "Model" }), {
      target: { value: "qwen2.5:0.5b" },
    });
    await ask("Hi again");
    expect(streamChat.mock.calls[1]?.[0]).toMatchObject({ model: "qwen2.5:0.5b" });
    localStorage.clear();
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
