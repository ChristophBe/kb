import { ChatService, type Conversation } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import {
  Code,
  ConnectError,
  toast,
  useClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@kb/module-sdk";
import { Button, Dialog, ErrorMessage, Input, Spinner } from "@kb/ui";
import { FileText, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Link } from "react-router";

/** What a scope means, for the header and announcements. */
export function describeScope(count: number): string {
  if (count === 0) return "all documents";
  return count === 1 ? "1 document" : `${count} documents`;
}

/** Replaces a conversation's scope; an empty list means all documents. */
export function useSetScope(conversation: Conversation) {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      client.updateConversation({ id: conversation.id, documentIds: { ids } }),
    onSuccess: (_, ids) => {
      toast.success(`Scope changed to ${describeScope(ids.length)}`);
      return queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: () => toast.error("The scope couldn't be changed. Try again."),
  });
}

/** Titles of the scoped documents by id; a deleted document has none. */
function useScopeTitles(ids: string[]) {
  const documents = useClient(DocumentService);
  return useQuery({
    queryKey: ["chat", "scope-documents", ...ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        ids.map(async (id): Promise<[string, string | null]> => {
          try {
            const { document } = await documents.getDocument({ id });
            return [id, document?.title || document?.filename || null];
          } catch (err) {
            if (err instanceof ConnectError && err.code === Code.NotFound) return [id, null];
            throw err;
          }
        }),
      );
      return new Map(entries);
    },
  });
}

/** The scope as chips that link to their documents, each with a remove button. */
export function ScopeChips({ conversation }: { conversation: Conversation }) {
  const ids = conversation.documentIds;
  const titles = useScopeTitles(ids);
  const setScope = useSetScope(conversation);
  const label = useId();
  const chips = useRef(new Map<string, HTMLAnchorElement>());

  const remove = (id: string, index: number) => {
    const rest = ids.filter((x) => x !== id);
    setScope.mutate(rest, {
      // Focus moves to the next chip, or the previous one when it was the last.
      onSuccess: () => {
        const next = rest[index] ?? rest[index - 1];
        if (next) chips.current.get(next)?.focus();
      },
    });
  };

  const name = (id: string) =>
    titles.data?.get(id) ?? (titles.isPending ? "Loading…" : "Deleted document");
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
      <span id={label}>Scope:</span>
      {ids.length === 0 ? (
        <span>all documents</span>
      ) : (
        <ul aria-labelledby={label} className="flex flex-wrap gap-1">
          {ids.map((id, i) => (
            <li
              key={id}
              className="inline-flex max-w-64 items-center rounded-control border border-border bg-surface-muted text-fg"
            >
              <Link
                ref={(el) => {
                  if (el) chips.current.set(id, el);
                  else chips.current.delete(id);
                }}
                to={`/m/document/${id}`}
                className="min-w-0 truncate py-0.5 pl-2 hover:underline"
              >
                {name(id)}
              </Link>
              <button
                type="button"
                aria-label={`Remove ${name(id)} from scope`}
                disabled={setScope.isPending}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-fg-muted hover:text-danger disabled:opacity-50"
                onClick={() => remove(id, i)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Choose documents": a dialog with a searchable checklist of all documents. */
export function DocumentPicker({ conversation }: { conversation: Conversation }) {
  const documents = useClient(DocumentService);
  const setScope = useSetScope(conversation);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const hint = useId();
  const open = selected !== null;
  const list = useQuery({
    queryKey: ["chat", "documents"],
    enabled: open,
    queryFn: () => documents.listDocuments({ page: { pageSize: 200 } }),
  });

  const close = () => {
    setSelected(null);
    opener.current?.focus();
  };
  const apply = () => {
    if (!selected) return;
    setScope.mutate(selected, { onSuccess: close });
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (s === null ? s : on ? [...s, id] : s.filter((x) => x !== id)));

  const query = search.trim().toLowerCase();
  const shown = (list.data?.documents ?? []).filter(
    (d) => !query || `${d.title} ${d.filename}`.toLowerCase().includes(query),
  );
  const count = conversation.documentIds.length;
  return (
    <>
      <Button
        ref={opener}
        variant="ghost"
        className="-ml-3 text-xs"
        onClick={() => {
          setSearch("");
          setSelected([...conversation.documentIds]);
        }}
      >
        <FileText className="size-4" aria-hidden="true" />
        {count === 0 ? "Choose documents" : `Documents (${count})`}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Choose documents for this chat"
        footer={
          <>
            <p id={hint} className="mr-auto self-center text-xs text-fg-muted">
              Leave empty to use all documents.
            </p>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={setScope.isPending}>
              Apply
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            type="search"
            aria-label="Search documents"
            placeholder="Search documents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {list.isPending && <Spinner />}
          <ErrorMessage
            error={list.error ? "The Documents service isn't available. Try again later." : null}
          />
          {list.data && (
            <fieldset aria-describedby={hint}>
              <legend className="sr-only">Documents</legend>
              {shown.length === 0 ? (
                <p className="text-fg-muted">
                  {query ? "No documents match your search." : "No documents yet."}
                </p>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {shown.map((d) => (
                    <li key={d.id}>
                      <label className="flex items-center gap-2 rounded-control px-1 py-1 hover:bg-surface-muted">
                        <input
                          type="checkbox"
                          checked={selected?.includes(d.id) ?? false}
                          onChange={(e) => toggle(d.id, e.target.checked)}
                        />
                        <span className="min-w-0 truncate">{d.title || d.filename}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}
        </div>
      </Dialog>
    </>
  );
}
