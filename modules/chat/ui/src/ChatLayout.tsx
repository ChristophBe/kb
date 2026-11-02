import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { toast, useClient, useMutation, useQuery, useQueryClient } from "@kb/module-sdk";
import { Button, cn, ErrorMessage } from "@kb/ui";
import { Plus, Trash2 } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";

export function ChatLayout() {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => client.listConversations({ page: { pageSize: 100 } }),
  });
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
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="p-3">
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="size-4" /> New chat
          </Button>
        </div>
        <ErrorMessage error={conversations.error ?? create.error} />
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.data?.conversations.map((c) => (
            <div
              key={c.id}
              className="group flex items-center rounded-control text-sm text-fg hover:bg-surface-muted has-[[aria-current=page]]:bg-surface-muted"
            >
              <NavLink
                to={c.id}
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
                onClick={() => remove.mutate(c.id)}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </nav>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}

export function ChatEmpty() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
      Start a new chat or pick a conversation.
    </div>
  );
}
