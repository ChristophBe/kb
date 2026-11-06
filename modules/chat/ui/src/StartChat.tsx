import { ChatService } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { useClient, useQueryClient } from "@kb/module-sdk";
import { ErrorMessage, Spinner } from "@kb/ui";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

/** What `StartChat` hands to the new conversation, which asks it on arrival. */
export interface StartState {
  question: string;
}

/**
 * `/m/chat/new?q=…`: creates a conversation and opens it, asking `q` there.
 * The home page's prompt submits here. The URL is replaced, so going back
 * doesn't create another conversation.
 */
export function StartChat() {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failed, setFailed] = useState(false);
  // Once per mount: StrictMode runs effects twice, which would create two conversations.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const question = params.get("q")?.trim() ?? "";
    client.createConversation({}).then(
      ({ conversation }) => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        if (!conversation) return setFailed(true);
        const state: StartState | undefined = question ? { question } : undefined;
        navigate(`../${conversation.id}`, { replace: true, state });
      },
      () => setFailed(true),
    );
  }, [client, queryClient, navigate, params]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      {failed ? (
        <ErrorMessage error="Chat is not available right now. Try again in a moment." />
      ) : (
        <Spinner label="Starting a conversation" />
      )}
    </div>
  );
}
