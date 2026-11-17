import { ChatService, type Conversation } from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { ConnectError, toast, useClient, useMutation, useQueryClient } from "@knowcel/module-sdk";
import { Button, Input } from "@knowcel/ui";
import { ChevronLeft } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { PromptEditor } from "./PromptEditor.tsx";

/** Frosted and sticky: messages scroll under it, blurred. It spans the scroll container's padding. */
const HEADER =
  "glass-subtle sticky top-0 z-10 -mx-4 flex flex-col gap-1 border-b border-border px-4 py-3 md:-mx-8 md:px-8";

export const UNTITLED = "New conversation";

/** Title of the open conversation, with rename in place. */
export function ConversationHeader({ conversation }: { conversation: Conversation }) {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const renameButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const returnFocus = useRef(false);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) {
      input.current?.select();
    } else if (returnFocus.current) {
      // Back to where the rename started.
      returnFocus.current = false;
      renameButton.current?.focus();
    }
  }, [editing]);

  const close = () => {
    returnFocus.current = true;
    setDraft(null);
    setError("");
  };

  const rename = useMutation({
    mutationFn: (title: string) => client.updateConversation({ id: conversation.id, title }),
    onSuccess: () => {
      toast.success("Conversation renamed");
      close();
      return queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => setError(ConnectError.from(err).rawMessage),
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const title = (draft ?? "").trim();
    if (!title) {
      setError("Title must not be empty");
      return;
    }
    rename.mutate(title);
  };

  if (!editing) {
    return (
      <header className={HEADER}>
        <div className="flex items-center gap-3">
          <Link
            to=".."
            aria-label="All conversations"
            title="All conversations"
            className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-muted hover:text-fg md:hidden"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-sans font-medium">
            {conversation.title || UNTITLED}
          </h1>
          <Button ref={renameButton} variant="ghost" onClick={() => setDraft(conversation.title)}>
            Rename
          </Button>
          <PromptEditor conversation={conversation} />
        </div>
      </header>
    );
  }
  return (
    <header className={HEADER}>
      <form onSubmit={save} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input
            ref={input}
            aria-label="Conversation title"
            value={draft}
            maxLength={200}
            aria-invalid={error !== ""}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          />
          {error && (
            <p id={errorId} className="mt-1 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={rename.isPending}>
          Save
        </Button>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
      </form>
    </header>
  );
}
