import { ChatService } from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { useClient, useQuery } from "@knowcel/module-sdk";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { notifyAnswerReady } from "./notify.ts";

/** The query key of the conversations' activity; invalidate it when an answer starts or ends. */
export const ACTIVITY_KEY = ["chat-activity"];

/** How often to look again while an answer is being written. */
const POLL_MS = 5000;

/**
 * The number of conversations whose answer finished while the user was away,
 * for the badge on the Chat entry (see `NavItem.useBadge`). It looks again
 * only while some answer is being written, and notifies (when allowed) about
 * answers that finish while the tab is hidden or another page is open.
 */
export function useUnseenAnswers(): number {
  const client = useClient(ChatService);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activity = useQuery({
    queryKey: ACTIVITY_KEY,
    queryFn: () => client.listConversations({ page: { pageSize: 50 } }),
    refetchInterval: (query) =>
      query.state.data?.conversations.some((c) => c.generating) ? POLL_MS : false,
  });
  const conversations = activity.data?.conversations;
  const unseen = conversations?.filter((c) => c.completedUnseen) ?? [];

  // Known ones don't notify again; the first load only learns what is there.
  const known = useRef<Set<string> | null>(null);
  const viewing = useRef("");
  viewing.current = pathname;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when new data arrives.
  useEffect(() => {
    if (!conversations) return;
    const before = known.current;
    known.current = new Set(unseen.map((c) => c.id));
    if (!before) return;
    for (const c of unseen) {
      if (before.has(c.id)) continue;
      const open = !document.hidden && viewing.current === `/m/chat/${c.id}`;
      if (!open) notifyAnswerReady(c.title, () => navigate(`/m/chat/${c.id}`));
    }
  }, [conversations]);

  return unseen.length;
}
