import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import { ConnectError, toast, useClient, useMutation, useQueryClient } from "@kb/module-sdk";
import { Button, fieldError, Input, PageTitle } from "@kb/ui";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

/** The document's title as the page heading, with editing in place. */
export function TitleEditor({ id, title }: { id: string; title: string }) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);
  const errorId = useId();
  const editing = draft !== null;

  useEffect(() => {
    if (editing) {
      input.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  const close = () => {
    returnFocus.current = true;
    setDraft(null);
    setError("");
  };

  const save = useMutation({
    mutationFn: (value: string) => client.updateDocument({ id, title: value }),
    onSuccess: () => {
      toast.success("Title saved");
      close();
      return queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err) => {
      // The server's message for the title field, else what went wrong.
      setError(fieldError(err, "title") ?? ConnectError.from(err).rawMessage);
      input.current?.focus();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = (draft ?? "").trim();
    if (!value) {
      setError("Title must not be empty");
      input.current?.focus();
      return;
    }
    save.mutate(value);
  };

  if (!editing) {
    return (
      <div className="mb-8 flex flex-wrap items-baseline gap-3">
        <PageTitle>{title}</PageTitle>
        <Button ref={editButton} variant="ghost" onClick={() => setDraft(title)}>
          Edit title
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mb-8 flex max-w-2xl items-start gap-2">
      <div className="min-w-0 flex-1">
        <Input
          ref={input}
          aria-label="Title"
          value={draft}
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
      <Button type="submit" disabled={save.isPending}>
        Save
      </Button>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
    </form>
  );
}
