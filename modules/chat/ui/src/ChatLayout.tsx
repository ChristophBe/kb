import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { useClient, useMutation, useQuery, useQueryClient } from "@kb/module-sdk";
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
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate("");
    },
  });

  return (
    <div className="-m-8 flex h-screen">
      <div className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="p-3">
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="size-4" /> New chat
          </Button>
        </div>
        <ErrorMessage error={conversations.error ?? create.error} />
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.data?.conversations.map((c) => (
            <NavLink
              key={c.id}
              to={c.id}
              className={({ isActive }) =>
                cn(
                  "group flex items-center justify-between rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100",
                  isActive && "bg-zinc-100 font-medium",
                )
              }
            >
              <span className="truncate">{c.title || "New conversation"}</span>
              <Trash2
                className="size-4 shrink-0 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600"
                onClick={(e) => {
                  e.preventDefault();
                  remove.mutate(c.id);
                }}
              />
            </NavLink>
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
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
      Start a new chat or pick a conversation.
    </div>
  );
}
