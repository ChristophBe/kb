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
import { FileText, Users, X } from "lucide-react";
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

/** Replaces a conversation's teams; an empty list means all documents. */
export function useSetTeams(conversation: Conversation) {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const { teams } = useMyTeams();
  return useMutation({
    mutationFn: (ids: string[]) =>
      client.updateConversation({ id: conversation.id, teamIds: { ids } }),
    onSuccess: (_, ids) => {
      const names = ids.flatMap((id) => teams.find((t) => t.id === id)?.name ?? []);
      toast.success(
        `Knowledge changed to ${describeScope(conversation.documentIds.length, names)}`,
      );
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
        toast.error("The teams couldn't be changed. Try again.");
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
export function ScopeChips({ conversation }: { conversation: Conversation }) {
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

/** "Choose teams": a dialog to limit the answers to documents of the user's teams. */
export function TeamScopePicker({ conversation }: { conversation: Conversation }) {
  const { teams, known } = useMyTeams();
  const setTeams = useSetTeams(conversation);
  const [selected, setSelected] = useState<string[] | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const current = useScopeTeams(conversation).names.length;

  // Without teams (none joined, or iam down) there is nothing to choose.
  if (!known || teams.length === 0) return null;
  const close = () => {
    setSelected(null);
    opener.current?.focus();
  };
  return (
    <>
      <Button
        ref={opener}
        variant="ghost"
        className="-ml-3 text-xs"
        onClick={() =>
          setSelected(conversation.teamIds.filter((id) => teams.some((t) => t.id === id)))
        }
      >
        <Users className="size-4" aria-hidden="true" />
        {current === 0 ? "Choose teams" : `Teams (${current})`}
      </Button>
      <Dialog
        open={selected !== null}
        onClose={close}
        title="Choose teams for this chat"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={setTeams.isPending}
              onClick={() => selected && setTeams.mutate(selected, { onSuccess: close })}
            >
              Apply
            </Button>
          </>
        }
      >
        <TeamPicker
          legend="Use documents of"
          hint="Leave all unticked to use every document you can read: public ones and those of your teams. With teams ticked, only documents of those teams are used, not public ones."
          options={teams.map((t) => ({ id: t.id, name: t.name }))}
          selected={selected ?? []}
          onChange={setSelected}
        />
      </Dialog>
    </>
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
