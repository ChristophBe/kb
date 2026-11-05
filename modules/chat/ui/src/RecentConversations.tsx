import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import {
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  RelativeTime,
  SkeletonRows,
  WidgetCard,
} from "@kb/ui";
import { MessageSquare } from "lucide-react";
import { Link } from "react-router";
import { UNTITLED } from "./ConversationHeader.tsx";

const RECENT = 5;

/** Home widget: the latest conversations, so returning users can pick one up. */
export function RecentConversations() {
  const client = useClient(ChatService);
  const conversations = useQuery({
    queryKey: ["conversations", "recent"],
    queryFn: () => client.listConversations({ page: { pageSize: RECENT } }),
  });
  const items = conversations.data?.conversations.slice(0, RECENT) ?? [];
  return (
    <WidgetCard
      title="Recent conversations"
      icon={MessageSquare}
      action={
        <Link to="/m/chat" className="font-medium text-accent hover:underline">
          All conversations
        </Link>
      }
    >
      {conversations.isPending ? (
        <DelayedLoading>
          <SkeletonRows label="Loading conversations" rows={RECENT} />
        </DelayedLoading>
      ) : conversations.error ? (
        <div className="p-4">
          <ErrorMessage error="Chat is not available right now. Try again in a moment." />
        </div>
      ) : items.length ? (
        <ul className="divide-y divide-dotted divide-border">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                to={`/m/chat/${c.id}`}
                className="flex items-baseline gap-3 px-5 py-3 text-sm hover:bg-surface-muted"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{c.title || UNTITLED}</span>
                <RelativeTime ts={c.updateTime} className="shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>
          No conversations yet.{" "}
          <Link to="/m/chat" className="font-medium text-accent hover:underline">
            Ask your first question.
          </Link>
        </EmptyState>
      )}
    </WidgetCard>
  );
}
