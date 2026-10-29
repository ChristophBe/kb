import { Button, cn, EmptyState, Input, Spinner, Textarea } from "@kb/ui";
import { AlertTriangle, Copy, Plus, Square, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from "react-router";
import {
  type Citation,
  type Conversation as Conv,
  type Message,
  newId,
  searchChunks,
  useStore,
} from "./store.tsx";
import {
  Dialog,
  LoadState,
  Skeleton,
  useAnnouncer,
  useMockQuery,
  useScenario,
  useToast,
} from "./ui.tsx";

// Chat flows from docs/ux/m1/chat.md. A question containing "fail", or the
// "Service unavailable" scenario, interrupts the answer mid-stream.

export function ChatLayout() {
  const { conversations, createConversation, deleteConversation } = useStore();
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useMockQuery(conversations, [], "The chat service");
  const [deleting, setDeleting] = useState<Conv | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);

  const confirmDelete = () => {
    if (!deleting) {
      return;
    }
    const index = conversations.findIndex((c) => c.id === deleting.id);
    const next = conversations[index + 1] ?? conversations[index - 1];
    deleteConversation(deleting.id);
    setDeleting(null);
    toast("success", "Conversation deleted");
    if (deleting.id === id) {
      navigate(next ? next.id : ".");
    }
    setTimeout(() => {
      const link = next && document.querySelector<HTMLElement>(`[data-conversation="${next.id}"]`);
      (link ?? newButton.current)?.focus();
    });
  };

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[28rem] overflow-hidden rounded-card border border-border">
      <div
        className={cn(
          "w-full shrink-0 flex-col border-r border-border bg-surface md:flex md:w-64",
          id ? "hidden" : "flex",
        )}
      >
        <div className="flex items-center justify-between gap-2 p-3">
          <h1 className="text-sm font-semibold">Conversations</h1>
          <Button
            ref={newButton}
            variant="secondary"
            onClick={() => navigate(createConversation([]).id)}
          >
            <Plus className="size-4" aria-hidden="true" /> New chat
          </Button>
        </div>
        <LoadState
          state={state}
          label="Loading conversations"
          skeleton={
            <div className="space-y-2 p-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          }
        >
          {(list) =>
            list.length === 0 ? (
              <EmptyState>No conversations yet.</EmptyState>
            ) : (
              <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-2 pb-2">
                <ul>
                  {list.map((c) => (
                    <li
                      key={c.id}
                      className="group flex items-center rounded-control text-sm hover:bg-surface-muted has-[[aria-current=page]]:bg-surface-muted"
                    >
                      <NavLink
                        to={c.id}
                        data-conversation={c.id}
                        className={({ isActive }) =>
                          cn("min-w-0 flex-1 truncate px-3 py-2", isActive && "font-medium")
                        }
                      >
                        {c.title || "New conversation"}
                      </NavLink>
                      <button
                        type="button"
                        aria-label={`Delete conversation ${c.title || "New conversation"}`}
                        className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-control text-fg-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-danger"
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )
          }
        </LoadState>
      </div>
      <div className={cn("min-w-0 flex-1 flex-col md:flex", id ? "flex" : "hidden")}>
        <Outlet />
      </div>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete "${deleting?.title || "New conversation"}"?`}
        footer={
          <>
            <Button variant="secondary" autoFocus onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" className="border border-danger" onClick={confirmDelete}>
              Delete conversation
            </Button>
          </>
        }
      >
        Its messages are removed. This can't be undone.
      </Dialog>
    </div>
  );
}

export function ChatIndex() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-fg-muted">
      Choose a conversation or start a new chat.
    </div>
  );
}

/** /chat/new?documents=d1,d2 creates a scoped conversation and opens it. */
export function NewScopedChat() {
  const [params] = useSearchParams();
  const { createConversation } = useStore();
  const navigate = useNavigate();
  const documents = params.get("documents") ?? "";
  useEffect(() => {
    const conv = createConversation(documents.split(",").filter(Boolean));
    navigate(`../${conv.id}`, { relative: "path", replace: true });
  }, [documents, createConversation, navigate]);
  return null;
}

export function Conversation() {
  const { id = "" } = useParams();
  const { conversations, docs, updateConversation } = useStore();
  const { scenario } = useScenario();
  const conv = conversations.find((c) => c.id === id);
  const [input, setInput] = useState("");
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(true);
  const [announcer, announce] = useAnnouncer();
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const stream = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendHint = useId();
  const streaming = conv?.messages.some((m) => m.state === "streaming") ?? false;

  // Focus the composer when a conversation opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the conversation changes.
  useEffect(() => {
    composer.current?.focus();
    stick.current = true;
  }, [id]);

  // Keep the newest message in view unless the user scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever messages change.
  useEffect(() => {
    if (stick.current && log.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [conv?.messages]);

  useEffect(
    () => () => {
      if (stream.current) {
        clearInterval(stream.current);
      }
    },
    [],
  );

  if (!conv) {
    return <EmptyState>Conversation not found.</EmptyState>;
  }

  const patchMessage = (messageId: string, patch: Partial<Message>) =>
    updateConversation(conv.id, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
    }));

  const finish = (messageId: string, patch: Partial<Message>, message: string) => {
    if (stream.current) {
      clearInterval(stream.current);
      stream.current = null;
    }
    patchMessage(messageId, patch);
    announce(message);
    composer.current?.focus();
  };

  const ask = (question: string) => {
    const results = useKnowledgeBase ? searchChunks(docs, question, conv.scope).slice(0, 2) : [];
    const citations: Citation[] = results.map((r, i) => ({
      n: i + 1,
      documentId: r.doc.id,
      chunkIndex: r.chunk.index,
      title: r.doc.title,
    }));
    const answer = results.length
      ? `Here is what I found in your documents:\n\n${results
          .map((r, i) => `- ${r.chunk.text.split(". ")[0]}. [${i + 1}]`)
          .join("\n")}\n\nAsk a follow-up question for **more detail**.`
      : "I couldn't find this in your documents. Try rephrasing, or widen the chat's scope.";
    const fail = scenario === "unavailable" || /fail/i.test(question);
    const assistant: Message = {
      id: newId("m"),
      role: "assistant",
      content: "",
      citations: [],
      state: "streaming",
    };
    updateConversation(conv.id, (c) => ({
      ...c,
      title: c.title || question.slice(0, 60),
      updated: new Date(),
      messages: [
        ...c.messages,
        { id: newId("m"), role: "user", content: question, citations: [], state: "complete" },
        assistant,
      ],
    }));
    announce("Searching documents…");
    stick.current = true;

    const tokens = answer.split(/(?<=\s)/);
    let i = 0;
    setTimeout(() => {
      patchMessage(assistant.id, { citations });
      stream.current = setInterval(() => {
        i += 1;
        if (fail && i > tokens.length / 2) {
          finish(
            assistant.id,
            {
              content: tokens.slice(0, i).join(""),
              state: "failed",
              error: "The Models service isn't available.",
            },
            "The answer was interrupted: the Models service isn't available.",
          );
          return;
        }
        if (i >= tokens.length) {
          finish(assistant.id, { content: answer, state: "complete" }, "Answer ready");
          return;
        }
        patchMessage(assistant.id, { content: tokens.slice(0, i).join("") });
      }, 60);
    }, 700);
  };

  const stop = () => {
    const current = conv.messages.find((m) => m.state === "streaming");
    if (current) {
      finish(current.id, { state: "stopped" }, "Answer stopped");
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || streaming) {
      return;
    }
    setInput("");
    ask(question);
  };

  const retry = (failed: Message) => {
    const index = conv.messages.findIndex((m) => m.id === failed.id);
    const question = conv.messages[index - 1]?.content ?? "";
    updateConversation(conv.id, (c) => ({
      ...c,
      messages: c.messages.filter((_, k) => k !== index && k !== index - 1),
    }));
    ask(question.replace(/fail/gi, "").trim() || question);
  };

  return (
    <>
      <ConversationHeader conv={conv} />
      <div
        ref={log}
        role="log"
        aria-live="off"
        aria-label="Messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-6 md:px-8"
      >
        {conv.messages.length === 0 ? (
          <div className="mx-auto max-w-md text-center text-sm text-fg-muted">
            <p>Ask a question about your documents.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {["How did revenue develop in Q3?", "What does the hiring plan say?"].map((p) => (
                <Button
                  key={p}
                  variant="secondary"
                  onClick={() => {
                    setInput(p);
                    composer.current?.focus();
                  }}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          conv.messages.map((m) => <MessageView key={m.id} message={m} onRetry={() => retry(m)} />)
        )}
      </div>
      <form onSubmit={send} className="border-t border-border bg-surface px-4 py-3 md:px-8">
        <label htmlFor="composer" className="sr-only">
          Ask a question
        </label>
        <Textarea
          id="composer"
          ref={composer}
          rows={2}
          value={input}
          placeholder="Ask a question…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape" && streaming) {
              e.preventDefault();
              stop();
            }
          }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={useKnowledgeBase}
              onChange={(e) => setUseKnowledgeBase(e.target.checked)}
            />
            Use knowledge base
          </label>
          <span className="flex items-center gap-2">
            <span id={sendHint} className="sr-only">
              {streaming ? "Wait for the answer or stop it (Escape)." : ""}
            </span>
            {streaming && (
              <Button variant="secondary" onClick={stop} title="Stop generating (Esc)">
                <Square className="size-3" aria-hidden="true" /> Stop
              </Button>
            )}
            <Button type="submit" disabled={!input.trim() || streaming} aria-describedby={sendHint}>
              Send
            </Button>
          </span>
        </div>
      </form>
      {announcer}
    </>
  );
}

function ConversationHeader({ conv }: { conv: Conv }) {
  const { docs, updateConversation } = useStore();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conv.title);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const errorId = useId();
  const scoped = conv.scope
    .map((id) => docs.find((d) => d.id === id))
    .filter((d) => d !== undefined);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title must not be empty");
      return;
    }
    updateConversation(conv.id, (c) => ({ ...c, title: title.trim() }));
    setRenaming(false);
    setError("");
    toast("success", "Conversation renamed");
    setTimeout(() => renameButton.current?.focus());
  };

  return (
    <div className="border-b border-border bg-surface px-4 py-3 md:px-8">
      <Link to=".." relative="path" className="mb-1 inline-block text-sm text-fg-muted md:hidden">
        ← Conversations
      </Link>
      {renaming ? (
        <form onSubmit={save} className="flex flex-wrap items-start gap-2">
          <div className="w-72 max-w-full">
            <label htmlFor="conv-title" className="sr-only">
              Conversation title
            </label>
            <Input
              id="conv-title"
              autoFocus
              value={title}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setRenaming(false);
                  setError("");
                  setTimeout(() => renameButton.current?.focus());
                }
              }}
            />
            {error && (
              <p id={errorId} className="mt-1 text-sm text-danger">
                {error}
              </p>
            )}
          </div>
          <Button type="submit">Save</Button>
          <Button variant="secondary" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{conv.title || "New conversation"}</h2>
          <Button
            ref={renameButton}
            variant="ghost"
            onClick={() => {
              setTitle(conv.title);
              setRenaming(true);
            }}
          >
            Rename
          </Button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-muted">Scope:</span>
        {scoped.length === 0 && <span>all documents</span>}
        {scoped.map((d) => (
          <span
            key={d.id}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-subtle py-0.5 pr-1 pl-3 text-xs text-neutral"
          >
            <Link to={`../../documents/${d.id}`} relative="path" className="hover:underline">
              {d.title}
            </Link>
            <button
              type="button"
              aria-label={`Remove ${d.title} from scope`}
              onClick={() =>
                updateConversation(conv.id, (c) => ({
                  ...c,
                  scope: c.scope.filter((s) => s !== d.id),
                }))
              }
              className="inline-flex size-6 items-center justify-center rounded-full hover:bg-surface"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <Button variant="ghost" onClick={() => setPicking(true)}>
          + {scoped.length ? "Change documents" : "Choose documents"}
        </Button>
      </div>
      {picking && (
        <ScopeDialog
          selected={conv.scope}
          onClose={() => setPicking(false)}
          onApply={(scope) => {
            updateConversation(conv.id, (c) => ({ ...c, scope }));
            setPicking(false);
            toast(
              "info",
              scope.length
                ? `Scope changed to ${scope.length} document${scope.length === 1 ? "" : "s"}`
                : "Scope changed to all documents",
            );
          }}
        />
      )}
    </div>
  );
}

function ScopeDialog({
  selected,
  onClose,
  onApply,
}: {
  selected: string[];
  onClose: () => void;
  onApply: (scope: string[]) => void;
}) {
  const { docs } = useStore();
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState(new Set(selected));
  const listId = useId();
  const visible = docs.filter(
    (d) => d.status === "ready" && d.title.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Choose documents for this chat"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply([...chosen])}>Apply</Button>
        </>
      }
    >
      <label htmlFor="scope-filter" className="text-xs text-fg-muted">
        Filter documents
      </label>
      <Input
        id="scope-filter"
        autoFocus
        value={filter}
        aria-controls={listId}
        onChange={(e) => setFilter(e.target.value)}
      />
      <p role="status" className="mt-1 text-xs text-fg-muted">
        {visible.length} document{visible.length === 1 ? "" : "s"}
      </p>
      <fieldset id={listId} className="mt-2 max-h-60 space-y-1 overflow-y-auto">
        <legend className="sr-only">Documents</legend>
        {visible.map((d) => (
          <label
            key={d.id}
            className="flex items-center gap-2 rounded-control px-2 py-1 hover:bg-surface-muted"
          >
            <input
              type="checkbox"
              checked={chosen.has(d.id)}
              onChange={(e) =>
                setChosen((s) => {
                  const next = new Set(s);
                  e.target.checked ? next.add(d.id) : next.delete(d.id);
                  return next;
                })
              }
            />
            {d.title}
          </label>
        ))}
      </fieldset>
      <p className="mt-2 text-xs text-fg-muted">Leave all unchecked to use all documents.</p>
    </Dialog>
  );
}

function MessageView({ message, onRetry }: { message: Message; onRetry: () => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-card bg-accent px-4 py-2 text-base whitespace-pre-wrap text-on-accent">
          {message.content}
        </p>
      </div>
    );
  }
  const searching = message.state === "streaming" && message.content === "";
  return (
    <article
      aria-busy={message.state === "streaming"}
      aria-label="Answer"
      className="max-w-[85%] rounded-card border border-border bg-surface px-4 py-3 text-base"
    >
      {searching ? (
        <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
          <Spinner label="Searching documents" /> Searching documents…
        </span>
      ) : (
        <Markdown text={message.content} citations={message.citations} />
      )}
      {message.state === "streaming" && !searching && (
        <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-fg" />
      )}
      {message.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-fg-muted">Sources:</span>
          {message.citations.map((c) => (
            <Link
              key={c.n}
              to={`../../documents/${c.documentId}#chunk-${c.chunkIndex}`}
              relative="path"
              className="rounded-full bg-neutral-subtle px-2 py-0.5 text-neutral hover:underline"
            >
              {c.n} {c.title}
            </Link>
          ))}
        </div>
      )}
      {message.state === "stopped" && (
        <p className="mt-2 text-sm text-fg-muted">
          <Square className="mr-1 inline size-3" aria-hidden="true" />
          Stopped
        </p>
      )}
      {message.state === "failed" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-danger">
          <AlertTriangle className="size-4" aria-hidden="true" />
          The answer was interrupted: {message.error}
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </article>
  );
}

/**
 * A deliberately small, safe Markdown subset: paragraphs, "- " lists, fenced
 * code, **bold**, `code` and [n] citation links. It builds React elements, so
 * raw HTML in an answer is shown as text, never executed (#41).
 */
function Markdown({ text, citations }: { text: string; citations: Citation[] }) {
  const toast = useToast();
  const inline = (s: string, key: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g).map((part, i) => {
      const k = `${key}-${i}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={k}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return (
          <code key={k} className="rounded bg-surface-muted px-1 text-sm">
            {part.slice(1, -1)}
          </code>
        );
      }
      const n = part.match(/^\[(\d+)\]$/)?.[1];
      const c = n ? citations.find((x) => x.n === Number(n)) : undefined;
      if (c) {
        return (
          <Link
            key={k}
            to={`../../documents/${c.documentId}#chunk-${c.chunkIndex}`}
            relative="path"
            aria-label={`Source ${c.n}: ${c.title}, chunk ${c.chunkIndex}`}
            className="align-super text-xs font-medium text-info underline"
          >
            [{c.n}]
          </Link>
        );
      }
      return part;
    });

  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, b) => {
        const key = `b${b}`;
        if (block.startsWith("```")) {
          const code = block.replace(/^```\w*\n?/, "").replace(/```$/, "");
          return (
            <div key={key} className="relative">
              <pre className="overflow-x-auto rounded-control bg-surface-muted p-3 text-sm">
                <code>{code}</code>
              </pre>
              <button
                type="button"
                aria-label="Copy code"
                className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-control text-fg-muted hover:bg-surface"
                onClick={() => {
                  navigator.clipboard?.writeText(code);
                  toast("success", "Code copied");
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        }
        const lines = block.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {lines.map((l, i) => (
                <li key={i}>{inline(l.slice(2), `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{inline(block, key)}</p>;
      })}
    </div>
  );
}
