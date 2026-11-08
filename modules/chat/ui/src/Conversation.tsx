import {
  type ChatMessage,
  ChatService,
  type Citation,
  type GetConversationResponse,
  MessageRole,
  MessageStatus,
} from "@kb/chat-api/kb/chat/v1/chat_pb";
import { Code, ConnectError, useClient, useQuery, useQueryClient } from "@kb/module-sdk";
import { Button, buttonClass, ErrorMessage, Spinner } from "@kb/ui";
import { ArrowUp, MessageSquare, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Answer } from "./Answer.tsx";
import { ConversationHeader } from "./ConversationHeader.tsx";
import { ModelPicker, useModelChoice } from "./model.tsx";
import type { StartState } from "./StartChat.tsx";
import { DocumentPicker } from "./scope.tsx";

interface Pending {
  question: string;
  answer: string;
  citations: Citation[];
  /** The reason from the stream's error event, once the answer failed. */
  failure?: string;
}

/** An answer the user stopped, shown until the refetched conversation has it. */
interface Stopped extends Pending {
  conversationId: string;
  /** The conversation's message count once the stopped answer is saved. */
  savedCount: number;
}

const INTERRUPTED = "The answer was interrupted.";
const SEND_HINT = "send-hint";

/** A readable reason for a call that failed outright, without the raw status. */
function readableError(err: unknown): string {
  const code = err instanceof ConnectError ? err.code : Code.Unknown;
  switch (code) {
    case Code.Unavailable:
      return "The Chat service isn't available. Try again in a moment.";
    case Code.NotFound:
      return "This conversation no longer exists.";
    default:
      return "Something went wrong. Try again.";
  }
}

export function Conversation() {
  const { id = "" } = useParams();
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const conversation = useQuery({
    queryKey: ["conversations", id],
    queryFn: () => client.getConversation({ id }),
  });
  const [input, setInput] = useState("");
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(true);
  const modelChoice = useModelChoice(id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reasons for answers that failed while this page was open, by message id.
  // Reloaded failures only have their status, so they get a generic reason.
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const [status, setStatus] = useState("");
  // Aborting the stream cancels the answer on the server, which saves it as stopped.
  const abort = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();
  const bottom = useRef<HTMLDivElement>(null);

  // Leaving the conversation stops its answer, like closing the tab does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the conversation changes.
  useEffect(() => () => abort.current?.abort(), [id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll down whenever new messages or tokens arrive.
  useEffect(() => {
    // Not returned: scrollIntoView gives a Promise in current Chrome, which React would call.
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.data, pending, stopped]);

  /** Refetches until the conversation has `count` messages: the server saves a
   * stopped answer once it notices the cancel, so the first refetch can miss it. */
  const refetchUntil = async (count: number) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      const data = queryClient.getQueryData<GetConversationResponse>(["conversations", id]);
      if ((data?.messages.length ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };

  const ask = async (question: string) => {
    if (!question || pending) return;
    setError(null);
    setStopped(null);
    setStatus("");
    let state: Pending = { question, answer: "", citations: [] };
    setPending(state);
    const controller = new AbortController();
    abort.current = controller;
    const savedCount = (conversation.data?.messages.length ?? 0) + 2;
    try {
      const stream = client.streamChat(
        {
          conversationId: id,
          content: question,
          model: modelChoice?.model ?? "",
          useKnowledgeBase,
        },
        { signal: controller.signal },
      );
      for await (const res of stream) {
        const event = res.event;
        if (event.case === "citations") state = { ...state, citations: event.value.items };
        if (event.case === "delta") state = { ...state, answer: state.answer + event.value };
        if (event.case === "error") state = { ...state, failure: event.value.message };
        if (event.case === "message" && state.failure !== undefined) {
          const [messageId, reason] = [event.value.id, state.failure];
          setFailures((f) => ({ ...f, [messageId]: reason }));
        }
        setPending(state);
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      if (controller.signal.aborted) {
        setStopped({ ...state, conversationId: id, savedCount });
        setStatus("Answer stopped");
        await refetchUntil(savedCount);
      } else {
        setError(readableError(err));
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      setPending(null);
    }
  };

  const stop = () => {
    abort.current?.abort();
    composer.current?.focus();
  };

  // A question handed over by StartChat (the home page's prompt): ask it once,
  // then drop it from the history entry so a reload doesn't ask again. Asked a
  // tick later and cancelled on cleanup: StrictMode's simulated unmount would
  // otherwise run the cleanup above and stop the answer it just started.
  const location = useLocation();
  const navigate = useNavigate();
  const handedOver = (location.state as StartState | null)?.question;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a navigation hands over a question.
  useEffect(() => {
    if (!handedOver) return;
    const timer = setTimeout(() => {
      navigate(".", { replace: true, state: null });
      ask(handedOver);
    });
    return () => clearTimeout(timer);
  }, [location.key]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;
    setInput("");
    ask(question);
  };

  const messages = conversation.data?.messages ?? [];
  // Only the newest answer can be retried: retrying resends the question before it.
  const last = messages.at(-1);
  const lastQuestion = messages.at(-2);
  const retry =
    last?.status === MessageStatus.FAILED && lastQuestion?.role === MessageRole.USER && !pending
      ? () => ask(lastQuestion.content)
      : undefined;
  return (
    <>
      {/* The header and composer float over the messages (frosted); scroll padding keeps focus clear of both (WCAG 2.4.11). */}
      <div className="flex flex-1 scroll-pt-24 scroll-pb-48 flex-col overflow-y-auto px-8">
        {conversation.data?.conversation && (
          <ConversationHeader conversation={conversation.data.conversation} />
        )}
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 pt-6">
          {conversation.isPending && <Spinner />}
          <ErrorMessage error={conversation.error ? readableError(conversation.error) : error} />
          {messages.map((m) => (
            <Bubble
              key={m.id}
              role={m.role}
              content={m.content}
              citations={m.citations}
              failure={m.status === MessageStatus.FAILED ? (failures[m.id] ?? "") : undefined}
              stopped={m.status === MessageStatus.STOPPED}
              announce={m.id in failures}
              onRetry={m === last ? retry : undefined}
            />
          ))}
          {stopped && stopped.conversationId === id && messages.length < stopped.savedCount && (
            <>
              <Bubble role={MessageRole.USER} content={stopped.question} citations={[]} />
              <Bubble
                role={MessageRole.ASSISTANT}
                content={stopped.answer}
                citations={stopped.citations}
                stopped
              />
            </>
          )}
          {pending && (
            <>
              <Bubble role={MessageRole.USER} content={pending.question} citations={[]} />
              <Bubble
                role={MessageRole.ASSISTANT}
                content={pending.answer || (pending.failure === undefined ? "…" : "")}
                citations={pending.citations}
                failure={pending.failure}
              />
            </>
          )}
          <div ref={bottom} />
        </div>
        <p role="status" className="sr-only">
          {status}
        </p>
        <form onSubmit={send} className="sticky bottom-4 mx-auto mt-6 mb-4 w-full max-w-3xl">
          {/* Styled like the home page's prompt: one glass field with a round Ask button. */}
          <div className="glass-strong flex flex-col gap-1 rounded-panel py-2 pr-2 pl-5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
            <div className="flex items-end gap-3">
              <MessageSquare className="mb-3.5 size-5 shrink-0 text-accent" aria-hidden="true" />
              <label htmlFor={composerId} className="sr-only">
                Message
              </label>
              <textarea
                id={composerId}
                ref={composer}
                rows={1}
                value={input}
                placeholder="Ask something…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) send(e);
                  if (e.key === "Escape" && pending) stop();
                }}
                className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-3 text-base field-sizing-content placeholder:text-fg-muted focus-visible:outline-none"
              />
              {pending && (
                <button
                  type="button"
                  title="Stop the answer (Esc)"
                  onClick={stop}
                  className={buttonClass("secondary", "rounded-full px-4 py-3")}
                >
                  <Square className="size-3 fill-current" aria-hidden="true" />
                  Stop
                </button>
              )}
              <button
                type="submit"
                aria-describedby={pending ? SEND_HINT : undefined}
                disabled={!input.trim() || pending !== null}
                className={buttonClass("primary", "rounded-full px-5 py-3")}
              >
                Ask
                <ArrowUp className="size-4" aria-hidden="true" />
              </button>
              <span id={SEND_HINT} hidden>
                Wait for the answer or stop it (Esc).
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1">
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={useKnowledgeBase}
                  onChange={(e) => setUseKnowledgeBase(e.target.checked)}
                />
                Answer from the knowledge base
              </label>
              {conversation.data?.conversation && useKnowledgeBase && (
                <DocumentPicker conversation={conversation.data.conversation} />
              )}
              {modelChoice && <ModelPicker choice={modelChoice} disabled={pending !== null} />}
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

function Bubble({
  role,
  content,
  citations,
  failure,
  stopped = false,
  announce = false,
  onRetry,
}: Pick<ChatMessage, "role" | "content" | "citations"> & {
  /** Set when the answer failed: the reason, or "" when it isn't known. */
  failure?: string;
  /** The user stopped the answer; its text so far is kept. */
  stopped?: boolean;
  /** Announces the failure as an alert; only for saved answers that just failed. */
  announce?: boolean;
  onRetry?: () => void;
}) {
  if (role === MessageRole.USER) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-card bg-accent-subtle px-4 py-2 text-base whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface px-4 py-2 text-base @container">
      {content && <Answer content={content} citations={citations} />}
      {stopped && (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Square className="size-3 fill-current" aria-hidden="true" />
          Stopped
        </p>
      )}
      {failure !== undefined && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-danger">
          <p role={announce ? "alert" : undefined} className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{failure ? `${INTERRUPTED} ${failure}` : INTERRUPTED}</span>
          </p>
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
