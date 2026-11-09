import { LlmService, type ProviderHealth } from "@kb/llm-api/kb/llm/v1/llm_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { Badge, DelayedLoading, SkeletonRows, Widget, WidgetMessage } from "@kb/ui";
import { Cpu } from "lucide-react";
import { Link } from "react-router";

/** How often the widget checks the providers again. */
const REFRESH_MS = 30_000;

function Row({
  label,
  health,
  model,
}: {
  label: string;
  health: Pick<ProviderHealth, "provider" | "healthy">;
  model: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="w-24 shrink-0 text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate">
        {health.provider}
        {model && <span className="ml-2 font-mono text-xs text-fg-muted">{model}</span>}
      </span>
      <Badge tone={health.healthy ? "success" : "danger"}>
        {health.healthy ? "healthy" : "unavailable"}
      </Badge>
    </li>
  );
}

/** Home-page widget: whether the chat and the embedding provider are available. */
export function ProviderStatus() {
  const client = useClient(LlmService);
  const status = useQuery({
    // Shared with the models page.
    queryKey: ["llm-status"],
    queryFn: () => client.getProviderStatus({}),
    refetchInterval: REFRESH_MS,
  });
  return (
    <Widget
      title="Models"
      icon={Cpu}
      action={
        <Link to="/m/llm" className="font-medium text-accent hover:underline">
          View models
        </Link>
      }
    >
      {status.isPending ? (
        <DelayedLoading>
          <SkeletonRows label="Checking the providers" rows={2} />
        </DelayedLoading>
      ) : status.isError ? (
        <WidgetMessage onRetry={() => status.refetch()}>
          The providers can't be checked right now.
        </WidgetMessage>
      ) : (
        <ul className="divide-y divide-dotted divide-border text-sm">
          {/* A server older than split providers sends no chat/embedding. */}
          <Row
            label="Chat"
            health={status.data.chat ?? status.data}
            model={status.data.defaultChatModel}
          />
          <Row
            label="Embedding"
            health={status.data.embedding ?? status.data}
            model={status.data.defaultEmbeddingModel}
          />
        </ul>
      )}
    </Widget>
  );
}
