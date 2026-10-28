import {
  type ChatMessage,
  ChatService,
  type Citation,
  MessageRole,
} from "@kb/chat-api/kb/chat/v1/chat_pb";
import { useClient, useQuery, useQueryClient } from "@kb/module-sdk";
import { Button, cn, ErrorMessage, Spinner, Textarea } from "@kb/ui";
import { Send } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

interface Pending {
  question: string;
  answer: string;
  citations: Citation[];
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
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<unknown>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll down whenever new messages or tokens arrive.
  useEffect(
    () => bottom.current?.scrollIntoView({ behavior: "smooth" }),
    [conversation.data, pending],
  );

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;
    setInput("");
    setError(null);
    let state: Pending = { question, answer: "", citations: [] };
    setPending(state);
    try {
      for await (const res of client.streamChat({
        conversationId: id,
        content: question,
        useKnowledgeBase,
      })) {
        if (res.event.case === "citations") state = { ...state, citations: res.event.value.items };
        if (res.event.case === "delta")
          state = { ...state, answer: state.answer + res.event.value };
        setPending(state);
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  };

  const messages = conversation.data?.messages ?? [];
  return (
    <>
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {conversation.isPending && <Spinner />}
          <ErrorMessage error={conversation.error ?? error} />
          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} content={m.content} citations={m.citations} />
          ))}
          {pending && (
            <>
              <Bubble role={MessageRole.USER} content={pending.question} citations={[]} />
              <Bubble
                role={MessageRole.ASSISTANT}
                content={pending.answer || "…"}
                citations={pending.citations}
              />
            </>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <form onSubmit={send} className="border-t border-zinc-200 bg-white px-8 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex gap-2">
            <Textarea
              rows={2}
              value={input}
              placeholder="Ask something…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) send(e);
              }}
            />
            <Button type="submit" disabled={!input.trim() || pending !== null}>
              <Send className="size-4" />
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={useKnowledgeBase}
              onChange={(e) => setUseKnowledgeBase(e.target.checked)}
            />
            Answer from the knowledge base
          </label>
        </div>
      </form>
    </>
  );
}

function Bubble({ role, content, citations }: Pick<ChatMessage, "role" | "content" | "citations">) {
  const isUser = role === MessageRole.USER;
  return (
    <div className={cn("flex flex-col gap-1", isUser && "items-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap",
          isUser ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white",
        )}
      >
        {content}
      </div>
      {citations.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap gap-1">
          {citations.map((c, i) => (
            <span
              key={`${c.documentId}-${c.chunkIndex}`}
              title={c.snippet}
              className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
            >
              [{i + 1}] {c.documentTitle}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
