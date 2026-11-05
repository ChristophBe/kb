import { ChatService, type Conversation } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { ConnectError, toast, useClient, useMutation, useQueryClient } from "@kb/module-sdk";
import { Button, Input } from "@kb/ui";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { ScopeChips } from "./scope.tsx";

export const UNTITLED = "New conversation";

/** Title of the open conversation, with rename in place, and its document scope. */
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
      <header className="flex flex-col gap-1 border-b border-border px-8 py-3">
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate font-medium">{conversation.title || UNTITLED}</h1>
          <Button ref={renameButton} variant="ghost" onClick={() => setDraft(conversation.title)}>
            Rename
          </Button>
        </div>
        <ScopeChips conversation={conversation} />
      </header>
    );
  }
  return (
    <header className="flex flex-col gap-1 border-b border-border px-8 py-3">
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
      <ScopeChips conversation={conversation} />
    </header>
  );
}
