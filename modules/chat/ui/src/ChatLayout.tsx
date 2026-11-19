import { ChatService } from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { toast, useClient, useMutation, useQuery, useQueryClient } from "@knowcel/module-sdk";
import {
  Area,
  Button,
  buttonClass,
  ConfirmDialog,
  EmptyState,
  ErrorMessage,
  IconButton,
  MessageSquare,
  NARROW_QUERY,
  navItemClass,
  Plus,
  RelativeTime,
  Trash2,
  Upload,
  useMediaQuery,
} from "@knowcel/ui";
import { useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useNavigate, useParams } from "react-router";
import { UNTITLED } from "./ConversationHeader.tsx";

/** The conversations, most recent message first. */
function useConversations() {
  const client = useClient(ChatService);
  return useQuery({
    queryKey: ["conversations"],
    queryFn: () => client.listConversations({ page: { pageSize: 100 } }),
  });
}

/** Creates a conversation and opens it. */
function useCreateConversation() {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => client.createConversation({}),
    onSuccess: ({ conversation }) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (conversation) navigate(conversation.id);
    },
  });
}

export function ChatLayout() {
  const { id: openId } = useParams();
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const conversations = useConversations();
  const create = useCreateConversation();
  // The conversation the delete confirmation asks about.
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const list = useRef<HTMLElement>(null);
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteConversation({ id }),
    onSuccess: async (_, id) => {
      toast.success("Conversation deleted");
      // Awaited: the index route must not redirect from the stale list back to
      // the deleted conversation, and the dialog closes (onSettled) only once
      // the entry is gone, so the focus falls back to the list.
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      // The index route opens the next most recent conversation.
      if (id === openId) navigate("");
    },
  });
  const confirmDelete = (id: string) =>
    remove.mutate(id, {
      onSettled: () => setDeleting(null),
    });

  return (
    // At narrow widths the list and the conversation are separate full-width views.
    <div className="page-fill flex">
      <Area
        tone="secondary"
        className={`h-full w-full shrink-0 border-r md:w-64 ${openId ? "max-md:hidden" : ""}`}
      >
        <div className="p-3">
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="size-4" /> New chat
          </Button>
        </div>
        <ErrorMessage error={conversations.error ?? create.error} />
        <nav
          ref={list}
          tabIndex={-1}
          aria-label="Conversations"
          className="flex-1 overflow-y-auto px-3 pb-3"
        >
          {conversations.data?.conversations.map((c) => (
            <div key={c.id} className={navItemClass(c.id === openId, "gap-0 p-0")}>
              <NavLink
                to={c.id}
                aria-labelledby={`${c.id}-title`}
                aria-describedby={
                  [c.lastMessagePreview && `${c.id}-preview`, c.lastMessageTime && `${c.id}-age`]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                className="min-w-0 flex-1 px-3 py-2"
              >
                <span className="flex items-baseline gap-2">
                  <span id={`${c.id}-title`} className="min-w-0 flex-1 truncate">
                    {c.title || UNTITLED}
                  </span>
                  <RelativeTime
                    id={`${c.id}-age`}
                    time={c.lastMessageTime}
                    className="shrink-0 text-xs font-normal text-fg-muted"
                  />
                </span>
                {c.lastMessagePreview && (
                  <span
                    id={`${c.id}-preview`}
                    className="block truncate text-xs font-normal text-fg-muted"
                  >
                    {c.lastMessagePreview}
                  </span>
                )}
              </NavLink>
              <IconButton
                label={`Delete conversation ${c.title || UNTITLED}`}
                tone="danger"
                className="mr-1"
                onClick={() => setDeleting({ id: c.id, title: c.title || UNTITLED })}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
        </nav>
      </Area>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete conversation?"
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && confirmDelete(deleting.id)}
        onCancel={() => setDeleting(null)}
        // After a delete, the entry's button is gone; the focus stays in the list.
        fallbackFocus={list}
      >
        “{deleting?.title}” and all its messages will be deleted. This can't be undone.
      </ConfirmDialog>
      <div className={`min-w-0 flex-1 flex-col ${openId ? "flex" : "hidden md:flex"}`}>
        <Outlet />
      </div>
    </div>
  );
}

/** Whether the knowledge base has no documents; unknown (false) until known or if it can't be told. */
function useNoDocuments(enabled: boolean) {
  const client = useClient(DocumentService);
  const documents = useQuery({
    queryKey: ["chat", "any-document"],
    enabled,
    queryFn: () => client.listDocuments({ page: { pageSize: 1 } }),
  });
  return documents.data !== undefined && documents.data.documents.length === 0;
}

/** Opens the most recent conversation, or shows the empty state when there is none. */
export function ChatIndex() {
  const conversations = useConversations();
  const create = useCreateConversation();
  // At narrow widths the index is the list of conversations itself.
  const narrow = useMediaQuery(NARROW_QUERY);
  const latest = conversations.data?.conversations[0];
  const noDocuments = useNoDocuments(conversations.data !== undefined && !latest);
  if (latest && !narrow) return <Navigate to={latest.id} replace />;
  if (conversations.isPending) return null;
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={MessageSquare}
        action={
          <>
            <ErrorMessage error={create.error} />
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                <Plus className="size-4" /> New chat
              </Button>
              {noDocuments && (
                <Link to="/m/ingestion" className={buttonClass("secondary")}>
                  <Upload className="size-4" aria-hidden="true" /> Upload documents
                </Link>
              )}
            </div>
          </>
        }
      >
        {noDocuments
          ? "Chat answers from your documents. Upload some first, then ask your questions here."
          : "Start a new chat."}
      </EmptyState>
    </div>
  );
}
