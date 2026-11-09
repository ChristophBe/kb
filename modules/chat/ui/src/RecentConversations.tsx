import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { DelayedLoading, RelativeTime, SkeletonRows, Widget, WidgetMessage } from "@kb/ui";
import { MessageSquare } from "lucide-react";
import { Link } from "react-router";
import { UNTITLED } from "./ConversationHeader.tsx";

/** How many conversations the home page lists. */
const RECENT = 5;

/** Home-page widget: the conversations with the latest messages. */
export function RecentConversations() {
  const client = useClient(ChatService);
  const conversations = useQuery({
    // Under "conversations", so that changes in the chat refresh it too.
    queryKey: ["conversations", "recent"],
    queryFn: () => client.listConversations({ page: { pageSize: RECENT } }),
  });
  return (
    <Widget
      title="Recent conversations"
      icon={MessageSquare}
      action={
        <Link to="/m/chat/new" className="font-medium text-accent hover:underline">
          New chat
        </Link>
      }
    >
      {conversations.isPending ? (
        <DelayedLoading>
          <SkeletonRows label="Loading conversations" rows={RECENT} />
        </DelayedLoading>
      ) : conversations.isError ? (
        <WidgetMessage onRetry={() => conversations.refetch()}>
          Your conversations can't be loaded right now.
        </WidgetMessage>
      ) : conversations.data.conversations.length === 0 ? (
        <WidgetMessage>No conversations yet. Ask a question above to start one.</WidgetMessage>
      ) : (
        <ul className="divide-y divide-dotted divide-border text-sm">
          {conversations.data.conversations.map((c) => (
            <li key={c.id} className="px-4 py-2">
              <span className="flex items-baseline gap-3">
                <Link
                  to={`/m/chat/${c.id}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {c.title || UNTITLED}
                </Link>
                <RelativeTime
                  time={c.lastMessageTime ?? c.createTime}
                  className="shrink-0 text-xs text-fg-muted"
                />
              </span>
              {c.lastMessagePreview && (
                <span className="block truncate text-xs text-fg-muted">{c.lastMessagePreview}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
