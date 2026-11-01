import { LlmService, ModelKind } from "@kb/llm-api/kb/llm/v1/llm_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { Badge, Card, EmptyState, ErrorMessage, PageHeader, Spinner } from "@kb/ui";

export function Models() {
  const client = useClient(LlmService);
  const status = useQuery({
    queryKey: ["llm-status"],
    queryFn: () => client.getProviderStatus({}),
  });
  const models = useQuery({ queryKey: ["llm-models"], queryFn: () => client.listModels({}) });

  return (
    <div>
      <PageHeader
        eyebrow="kb / llm"
        title="Models"
        description="The LLM provider used by all modules."
      />
      <ErrorMessage error={status.error ?? models.error} />
      {status.data && (
        <Card className="mb-6 grid max-w-2xl grid-cols-2 gap-y-2 p-4 text-sm">
          <span className="text-fg-muted">Provider</span>
          <span className="flex items-center gap-2">
            {status.data.provider}
            <Badge tone={status.data.healthy ? "success" : "danger"}>
              {status.data.healthy ? "healthy" : "unavailable"}
            </Badge>
          </span>
          <span className="text-fg-muted">Detail</span>
          <span>{status.data.detail}</span>
          <span className="text-fg-muted">Chat model</span>
          <span>{status.data.defaultChatModel}</span>
          <span className="text-fg-muted">Embedding model</span>
          <span>
            {status.data.defaultEmbeddingModel} ({status.data.embeddingDimensions} dims)
          </span>
        </Card>
      )}
      <Card className="max-w-2xl">
        {models.isPending ? (
          <EmptyState>
            <Spinner />
          </EmptyState>
        ) : models.data?.models.length ? (
          <ul className="divide-y divide-dotted divide-border text-sm">
            {models.data.models.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-4 py-2">
                <span className="font-mono">{m.id}</span>
                <Badge tone={m.kind === ModelKind.EMBEDDING ? "info" : "neutral"}>
                  {m.kind === ModelKind.EMBEDDING ? "embedding" : "chat"}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No models installed.</EmptyState>
        )}
      </Card>
    </div>
  );
}
