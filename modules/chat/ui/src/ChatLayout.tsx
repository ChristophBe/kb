import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { toast, useClient, useMutation, useQuery, useQueryClient } from "@kb/module-sdk";
import { Area, Button, ErrorMessage, IconButton, navItemClass, RelativeTime } from "@kb/ui";
import { Plus, Trash2 } from "lucide-react";
import { Navigate, NavLink, Outlet, useNavigate, useParams } from "react-router";
import { UNTITLED } from "./ConversationHeader.tsx";

/** The conversations, most recent message first. */
function useConversations() {
  const client = useClient(ChatService);
  return useQuery({
    queryKey: ["conversations"],
    queryFn: () => client.listConversations({ page: { pageSize: 100 } }),
  });
}

export function ChatLayout() {
  const { id: openId } = useParams();
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const conversations = useConversations();
  const create = useMutation({
    mutationFn: () => client.createConversation({}),
    onSuccess: ({ conversation }) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (conversation) navigate(conversation.id);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteConversation({ id }),
    onSuccess: () => {
      toast.success("Conversation deleted");
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate("");
    },
  });

  return (
    <div className="-m-8 flex h-screen">
      <Area tone="secondary" className="w-64 shrink-0 border-r">
        <div className="p-3">
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="size-4" /> New chat
          </Button>
        </div>
        <ErrorMessage error={conversations.error ?? create.error} />
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {conversations.data?.conversations.map((c) => (
            <div key={c.id} className={navItemClass(c.id === openId, "group gap-0 p-0")}>
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
                className="mr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={() => remove.mutate(c.id)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
        </nav>
      </Area>
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}

/** Opens the most recent conversation, or shows the empty state when there is none. */
export function ChatIndex() {
  const conversations = useConversations();
  const latest = conversations.data?.conversations[0];
  if (latest) return <Navigate to={latest.id} replace />;
  if (conversations.isPending) return null;
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
      Start a new chat.
    </div>
  );
}
