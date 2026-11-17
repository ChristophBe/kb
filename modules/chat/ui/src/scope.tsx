import { ChatService, type Conversation } from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import {
  Code,
  ConnectError,
  toast,
  useClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import { Button, Dialog, ErrorMessage, IconButton, Input, Spinner, TeamPicker } from "@knowcel/ui";
import { Library, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useMyTeams } from "./useMyTeams.ts";

/**
 * What a scope means, for the header and announcements: the number of chosen
 * documents and the names of the chosen teams, either of which may be none.
 */
export function describeScope(count: number, teams: string[] = []): string {
  const documents = count === 1 ? "1 document" : `${count} documents`;
  const named = teams.length === 1 ? `team ${teams[0]}` : `teams ${teams.join(", ")}`;
  if (teams.length === 0) return count === 0 ? "all documents" : documents;
  return count === 0 ? `documents of ${named}` : `${documents} of ${named}`;
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

/**
 * The teams of a conversation's scope that the user is still in, by name. A
 * team that was deleted or that they left no longer counts, as for the
 * answer. While teams can't be looked up, the ids stand without names.
 */
export function useScopeTeams(conversation: Conversation): { names: string[]; known: boolean } {
  const { teams, known } = useMyTeams();
  if (!known) return { names: [], known };
  const names = conversation.teamIds.flatMap((id) => teams.find((t) => t.id === id)?.name ?? []);
  return { names, known };
}

/** Replaces a conversation's documents and teams in one request; empty lists mean all documents. */
export function useSetSources(conversation: Conversation) {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const { teams } = useMyTeams();
  return useMutation({
    mutationFn: (sources: { documentIds: string[]; teamIds: string[] }) =>
      client.updateConversation({
        id: conversation.id,
        documentIds: { ids: sources.documentIds },
        teamIds: { ids: sources.teamIds },
      }),
    onSuccess: (_, sources) => {
      const names = sources.teamIds.flatMap((id) => teams.find((t) => t.id === id)?.name ?? []);
      toast.success(`Sources changed to ${describeScope(sources.documentIds.length, names)}`);
      return queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => {
      const code = ConnectError.from(err).code;
      if (code === Code.PermissionDenied) {
        toast.error(
          "You're not a member of one of the teams. One you joined a moment ago can take up to half a minute to work here.",
        );
      } else if (code === Code.Unavailable) {
        toast.error("Teams can't be looked up right now. Try again in a moment.");
      } else {
        toast.error("The sources couldn't be changed. Try again.");
      }
    },
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
export function ScopeChips({
  conversation,
  useKnowledgeBase = true,
}: {
  conversation: Conversation;
  /** Whether the next questions use platform knowledge; when off, no scope applies. */
  useKnowledgeBase?: boolean;
}) {
  const ids = conversation.documentIds;
  const titles = useScopeTitles(ids);
  const setScope = useSetScope(conversation);
  const teams = useScopeTeams(conversation);
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
  if (!useKnowledgeBase) {
    return <p className="text-xs text-fg-muted">No platform knowledge – model only</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
      <span id={label}>Scope:</span>
      {ids.length === 0 ? (
        teams.names.length === 0 && <span>all documents</span>
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
              <IconButton
                label={`Remove ${name(id)} from scope`}
                tone="danger"
                disabled={setScope.isPending}
                className="size-6 hover:bg-transparent"
                onClick={() => remove(id, i)}
              >
                <X className="size-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {teams.names.length > 0 && (
        <span>
          {ids.length === 0 ? "documents of " : "in "}
          {teams.names.length === 1 ? "team" : "teams"}{" "}
          <span className="text-fg">{teams.names.join(", ")}</span>
        </span>
      )}
    </div>
  );
}

/**
 * "Sources": one dialog to choose the documents and teams that answers come
 * from. A searchable checklist of documents, and the user's teams when they
 * have any; one Apply saves both.
 */
export function SourcesControl({
  conversation,
  useKnowledgeBase,
  onUseKnowledgeBaseChange,
}: {
  conversation: Conversation;
  /** Whether questions use platform knowledge; applied with the sources. */
  useKnowledgeBase: boolean;
  onUseKnowledgeBaseChange: (on: boolean) => void;
}) {
  const documents = useClient(DocumentService);
  const { teams, known } = useMyTeams();
  const setSources = useSetSources(conversation);
  const [selected, setSelected] = useState<{
    documentIds: string[];
    teamIds: string[];
    useKnowledgeBase: boolean;
  } | null>(null);
  const [search, setSearch] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const hint = useId();
  const knowledgeHint = useId();
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
    const { useKnowledgeBase: on, ...sources } = selected;
    // Switching platform knowledge off keeps the saved sources as they were.
    if (!on) {
      onUseKnowledgeBaseChange(false);
      close();
      return;
    }
    setSources.mutate(sources, {
      onSuccess: () => {
        onUseKnowledgeBaseChange(true);
        close();
      },
    });
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((s) =>
      s === null
        ? s
        : {
            ...s,
            documentIds: on ? [...s.documentIds, id] : s.documentIds.filter((x) => x !== id),
          },
    );

  const query = search.trim().toLowerCase();
  const shown = (list.data?.documents ?? []).filter(
    (d) => !query || `${d.title} ${d.filename}`.toLowerCase().includes(query),
  );
  const hasTeams = known && teams.length > 0;
  return (
    <>
      <Button
        ref={opener}
        variant="ghost"
        className="-ml-3 text-xs"
        title="Choose where answers come from"
        onClick={() => {
          setSearch("");
          setSelected({
            useKnowledgeBase,
            documentIds: [...conversation.documentIds],
            // A team the user left or that was deleted no longer counts.
            teamIds: conversation.teamIds.filter((id) => teams.some((t) => t.id === id)),
          });
        }}
      >
        <Library className="size-4" aria-hidden="true" />
        Sources
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Sources for this chat"
        footer={
          <>
            <p id={hint} className="mr-auto self-center text-xs text-fg-muted">
              Leave everything empty to use all documents you can read.
            </p>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={setSources.isPending}>
              Apply
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={selected?.useKnowledgeBase ?? true}
                aria-describedby={knowledgeHint}
                onChange={(e) =>
                  setSelected((s) =>
                    s === null ? s : { ...s, useKnowledgeBase: e.target.checked },
                  )
                }
              />
              Use platform knowledge
            </label>
            <p id={knowledgeHint} className="pl-6 text-xs text-fg-muted">
              Answers are based on the documents and teams you can access in Knowcelium.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Input
              type="search"
              aria-label="Search documents"
              disabled={!selected?.useKnowledgeBase}
              placeholder="Search documents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {list.isPending && <Spinner />}
            <ErrorMessage
              error={list.error ? "The Documents service isn't available. Try again later." : null}
            />
            {list.data && (
              <fieldset aria-describedby={hint} disabled={!selected?.useKnowledgeBase}>
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
                            checked={selected?.documentIds.includes(d.id) ?? false}
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
          {hasTeams && (
            <TeamPicker
              legend="Use documents of"
              hint="With teams ticked, only documents of those teams are used, not public ones."
              options={teams.map((t) => ({
                id: t.id,
                name: t.name,
                disabled: !selected?.useKnowledgeBase,
              }))}
              selected={selected?.teamIds ?? []}
              onChange={(teamIds) => setSelected((s) => (s === null ? s : { ...s, teamIds }))}
            />
          )}
        </div>
      </Dialog>
    </>
  );
}
