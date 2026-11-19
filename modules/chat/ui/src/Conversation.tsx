import {
  type ChatMessage,
  ChatService,
  type Citation,
  type GetConversationResponse,
  MessageRole,
  MessageStatus,
  ProgressStage,
} from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import {
  Code,
  ConnectError,
  toast,
  useClient,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import {
  ArrowUp,
  Button,
  buttonClass,
  Copy,
  ErrorMessage,
  MessageSquare,
  RotateCcw,
  Spinner,
  Square,
  TriangleAlert,
} from "@knowcel/ui";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Answer } from "./Answer.tsx";
import { ACTIVITY_KEY } from "./badge.ts";
import { ConversationHeader } from "./ConversationHeader.tsx";
import { ModelPicker, useModelChoice } from "./model.tsx";
import { notifyAnswerReady, offerNotifications } from "./notify.ts";
import type { StartState } from "./StartChat.tsx";
import { ScopeChips, SourcesControl } from "./scope.tsx";

interface Pending {
  question: string;
  answer: string;
  citations: Citation[];
  /** What the system is doing until the first words arrive. */
  stage: ProgressStage;
  /** The reason from the stream's error event, once the answer failed. */
  failure?: string;
}

/** An answer the user stopped, shown until the refetched conversation has it. */
interface Stopped extends Pending {
  conversationId: string;
  /** The conversation's message count once the stopped answer is saved. */
  savedCount: number;
}

const STAGE_LABELS: Record<ProgressStage, string> = {
  [ProgressStage.UNSPECIFIED]: "Writing the answer…",
  [ProgressStage.SEARCHING]: "Searching your documents and the user manual…",
  [ProgressStage.RATING]: "Choosing the best passages…",
  [ProgressStage.WRITING]: "Writing the answer…",
};

/** What the system is doing while no words of the answer are there yet. */
function ProgressLine({ stage }: { stage: ProgressStage }) {
  return (
    <div className="flex items-center gap-2 rounded-card border border-border bg-surface px-4 py-2 text-base text-fg-muted">
      <Spinner />
      {STAGE_LABELS[stage]}
    </div>
  );
}

const INTERRUPTED = "The answer was interrupted.";
const SEND_HINT = "send-hint";
const GENERATING_POLL_MS = 2000;

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

/** Copies an answer's text (Markdown, without the source notes) to the clipboard. */
async function copyAnswer(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    toast.success("Answer copied");
  } catch {
    toast.error("Couldn't copy the answer. Select its text and copy it instead.");
  }
}

export function Conversation() {
  const { id = "" } = useParams();
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const conversation = useQuery({
    queryKey: ["conversations", id],
    queryFn: () => client.getConversation({ id }),
    // An answer written while nobody follows it (a reopened page): look again until it is done.
    refetchInterval: (query) =>
      query.state.data?.conversation?.generating && !abort.current ? GENERATING_POLL_MS : false,
  });
  const [input, setInput] = useState("");
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(true);
  const modelChoice = useModelChoice(id);
  const [pending, setPending] = useState<Pending | null>(null);
  // An answer is being written that this page isn't following (it was left and reopened).
  const generating = !pending && Boolean(conversation.data?.conversation?.generating);
  const busy = pending !== null || generating;
  const [error, setError] = useState<string | null>(null);
  // Reasons for answers that failed while this page was open, by message id.
  // Reloaded failures only have their status, so they get a generic reason.
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const [status, setStatus] = useState("");
  // Aborting the stream only stops following the answer; `stop` also tells the server.
  const abort = useRef<AbortController | null>(null);
  // Set while the user stops the answer, to tell Stop from leaving the page.
  const stopping = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();
  const bottom = useRef<HTMLDivElement>(null);

  // Leaving the conversation stops following its answer, which is written on in the background.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the conversation changes.
  useEffect(() => () => abort.current?.abort(), [id]);

  // The server clears "answer finished while away" when it serves the conversation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the conversation is loaded.
  useEffect(() => {
    if (conversation.isSuccess) queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
  }, [id, conversation.isSuccess]);

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
    if (!question || busy) return;
    setError(null);
    setStopped(null);
    setStatus("");
    // Without platform knowledge there is no search; the first event may take a moment.
    const stage = useKnowledgeBase ? ProgressStage.SEARCHING : ProgressStage.WRITING;
    let state: Pending = { question, answer: "", citations: [], stage };
    setPending(state);
    setStatus(STAGE_LABELS[stage]);
    const controller = new AbortController();
    abort.current = controller;
    stopping.current = false;
    offerNotifications();
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
      // The answer is now being written; the sidebar badge looks for its end.
      queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
      for await (const res of stream) {
        const event = res.event;
        if (event.case === "citations") state = { ...state, citations: event.value.items };
        if (event.case === "progress") {
          state = { ...state, stage: event.value };
          setStatus(STAGE_LABELS[event.value]);
        }
        if (event.case === "delta") {
          if (!state.answer) setStatus("");
          state = { ...state, answer: state.answer + event.value };
        }
        if (event.case === "error") {
          state = { ...state, failure: event.value.message };
          setStatus("");
        }
        if (event.case === "message" && state.failure !== undefined) {
          const [messageId, reason] = [event.value.id, state.failure];
          setFailures((f) => ({ ...f, [messageId]: reason }));
        }
        if (event.case === "message" && document.hidden) {
          const title = conversation.data?.conversation?.title ?? "";
          notifyAnswerReady(title, () => window.focus());
        }
        setPending(state);
      }
      setStatus("");
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
    } catch (err) {
      if (controller.signal.aborted && !stopping.current) {
        // Left the page: the answer goes on without us.
      } else if (controller.signal.aborted) {
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
    stopping.current = true;
    client
      .stopChat({ conversationId: id })
      .then(() => queryClient.invalidateQueries({ queryKey: ["conversations"] }))
      .catch(() => {});
    abort.current?.abort();
    composer.current?.focus();
  };

  // A question handed over by StartChat: ask it once,
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
    if (!question || busy) return;
    setInput("");
    ask(question);
  };

  const messages = conversation.data?.messages ?? [];
  // Only the newest answer can be retried or stopped: retrying resends the question before it.
  const last = messages.at(-1);
  const lastQuestion = messages.at(-2);
  const retry =
    (last?.status === MessageStatus.FAILED || last?.status === MessageStatus.STOPPED) &&
    lastQuestion?.role === MessageRole.USER &&
    !busy
      ? () => ask(lastQuestion.content)
      : undefined;
  return (
    <>
      {/* The header and composer float over the messages (frosted); scroll padding keeps focus clear of both (WCAG 2.4.11). */}
      <div className="flex flex-1 scroll-pt-24 scroll-pb-48 flex-col overflow-y-auto px-4 md:px-8">
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
              conversationId={id}
              failure={m.status === MessageStatus.FAILED ? (failures[m.id] ?? "") : undefined}
              stopped={m.status === MessageStatus.STOPPED}
              announce={m.id in failures}
              actions={m === last && !busy && m.role === MessageRole.ASSISTANT}
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
              {pending.answer || pending.failure !== undefined ? (
                <Bubble
                  role={MessageRole.ASSISTANT}
                  content={pending.answer}
                  citations={pending.citations}
                  failure={pending.failure}
                />
              ) : (
                <ProgressLine stage={pending.stage} />
              )}
            </>
          )}
          {generating && <ProgressLine stage={ProgressStage.WRITING} />}
          <div ref={bottom} />
        </div>
        <p role="status" className="sr-only">
          {status}
        </p>
        <form onSubmit={send} className="sticky bottom-4 mx-auto mt-6 mb-4 w-full max-w-3xl">
          {/* One glass field with a round Ask button. */}
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
                  if (e.key === "Escape" && busy) stop();
                }}
                className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-3 text-base field-sizing-content placeholder:text-fg-muted focus-visible:outline-none"
              />
              {busy && (
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
                aria-describedby={busy ? SEND_HINT : undefined}
                disabled={!input.trim() || busy}
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
              {conversation.data?.conversation && (
                <SourcesControl
                  conversation={conversation.data.conversation}
                  useKnowledgeBase={useKnowledgeBase}
                  onUseKnowledgeBaseChange={setUseKnowledgeBase}
                />
              )}
              {modelChoice && <ModelPicker choice={modelChoice} disabled={busy} />}
              {conversation.data?.conversation && (
                <ScopeChips
                  conversation={conversation.data.conversation}
                  useKnowledgeBase={useKnowledgeBase}
                />
              )}
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
  conversationId,
  failure,
  stopped = false,
  announce = false,
  actions = false,
  onRetry,
}: Pick<ChatMessage, "role" | "content" | "citations"> & {
  /** The conversation the answer is in, for what other modules add to its sources. */
  conversationId?: string;
  /** Set when the answer failed: the reason, or "" when it isn't known. */
  failure?: string;
  /** The user stopped the answer; its text so far is kept. */
  stopped?: boolean;
  /** Announces the failure as an alert; only for saved answers that just failed. */
  announce?: boolean;
  /** Shows the answer's actions: Copy, and Retry when `onRetry` is set. */
  actions?: boolean;
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
      {content && (
        <Answer content={content} citations={citations} conversationId={conversationId} />
      )}
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
        </div>
      )}
      {actions && (content || onRetry) && (
        <div className="flex flex-wrap items-center gap-2">
          {content && (
            <Button variant="ghost" onClick={() => copyAnswer(content)}>
              <Copy className="size-4" aria-hidden="true" />
              Copy answer
            </Button>
          )}
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
