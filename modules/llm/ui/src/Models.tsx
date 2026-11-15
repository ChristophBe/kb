import {
  LlmService,
  type Model,
  ModelKind,
  type ProviderHealth,
} from "@knowcel/llm-api/knowcel/llm/v1/llm_pb";
import {
  toast,
  useClient,
  useIsPlatformAdmin,
  useMutation,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Spinner,
  useDocumentTitle,
} from "@knowcel/ui";
import { Cpu } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { modelError } from "./errors.ts";

function Provider({ health }: { health: Pick<ProviderHealth, "provider" | "healthy"> }) {
  return (
    <span className="flex items-center gap-2">
      {health.provider}
      <Badge tone={health.healthy ? "success" : "danger"}>
        {health.healthy ? "healthy" : "unavailable"}
      </Badge>
    </span>
  );
}

/** How far a model download is: the step the provider reports and its bytes. */
interface Pulling {
  model: string;
  status: string;
  completed: number;
  total: number;
}

export function Models() {
  useDocumentTitle("Models");
  const client = useClient(LlmService);
  const queryClient = useQueryClient();
  const isAdmin = useIsPlatformAdmin();
  const status = useQuery({
    queryKey: ["llm-status"],
    queryFn: () => client.getProviderStatus({}),
  });
  const models = useQuery({ queryKey: ["llm-models"], queryFn: () => client.listModels({}) });

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [provider, setProvider] = useState("");
  const [pulling, setPulling] = useState<Pulling | null>(null);
  const [pullError, setPullError] = useState<Error | null>(null);
  const [deleting, setDeleting] = useState<Model | null>(null);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // The providers a model can be pulled to: the chat and the embedding provider.
  const providers = [
    ...new Set(
      status.data
        ? [
            (status.data.chat ?? status.data).provider,
            (status.data.embedding ?? status.data).provider,
          ]
        : [],
    ),
  ];
  const target = providers.includes(provider) ? provider : (providers[0] ?? "");

  async function pull(model: string) {
    const abort = new AbortController();
    controller.current = abort;
    setPullError(null);
    setPulling({ model, status: "Starting", completed: 0, total: 0 });
    try {
      for await (const step of client.pullModel(
        { provider: target, model },
        { signal: abort.signal },
      )) {
        setPulling({
          model,
          status: step.status,
          completed: Number(step.completed),
          total: Number(step.total),
        });
      }
      toast.success(`Pulled ${model}`);
      setName("");
    } catch (err) {
      if (!abort.signal.aborted) setPullError(modelError(err));
    } finally {
      setPulling(null);
      // Also after a cancel: the provider may have kept what it had.
      await queryClient.invalidateQueries({ queryKey: ["llm-models"] });
    }
  }

  const remove = useMutation({
    mutationFn: (m: Model) => client.deleteModel({ provider: m.provider, model: m.id }),
    // One error at a time: a failed pull is old news once something else is tried.
    onMutate: () => setPullError(null),
    onSuccess: async (_, m) => {
      toast.success(`Deleted ${m.id}`);
      await queryClient.invalidateQueries({ queryKey: ["llm-models"] });
    },
    onSettled: () => setDeleting(null),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const model = name.trim();
    if (!model) {
      setNameError("Model name must not be empty");
      input.current?.focus();
      return;
    }
    setNameError("");
    void pull(model);
  };

  return (
    <div>
      <PageHeader
        eyebrow="knowcelium / models"
        title="Models"
        description="The LLM providers used by all modules."
      />
      <ErrorMessage error={status.error ?? models.error} />
      <ErrorMessage error={modelError(remove.error)} />
      {status.data && (
        <Card className="mb-6 grid max-w-2xl grid-cols-2 gap-y-2 p-4 text-sm">
          <span className="text-fg-muted">Chat provider</span>
          {/* A server older than split providers sends no chat/embedding. */}
          <Provider health={status.data.chat ?? status.data} />
          <span className="text-fg-muted">Chat model</span>
          <span>{status.data.defaultChatModel}</span>
          <span className="text-fg-muted">Embedding provider</span>
          <Provider health={status.data.embedding ?? status.data} />
          <span className="text-fg-muted">Embedding model</span>
          <span>
            {status.data.defaultEmbeddingModel} ({status.data.embeddingDimensions} dims)
          </span>
          <span className="text-fg-muted">Detail</span>
          <span>{status.data.detail}</span>
        </Card>
      )}
      {isAdmin && (
        <form onSubmit={submit} className="mb-6 flex max-w-2xl flex-col gap-2">
          <label htmlFor="model-name" className="text-sm font-medium">
            Pull a model
          </label>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Input
                id="model-name"
                ref={input}
                placeholder="e.g. llama3.2"
                value={name}
                disabled={pulling !== null}
                aria-invalid={nameError !== ""}
                aria-describedby={nameError ? "model-name-error" : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {nameError && (
                <p id="model-name-error" className="mt-1 text-xs text-danger">
                  {nameError}
                </p>
              )}
            </div>
            {providers.length > 1 && (
              <select
                aria-label="Provider"
                value={target}
                disabled={pulling !== null}
                onChange={(e) => setProvider(e.target.value)}
                className="rounded-control border border-border-strong bg-surface px-3 py-1.5 text-sm hover:border-fg-muted"
              >
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
            {pulling ? (
              <Button variant="secondary" onClick={() => controller.current?.abort()}>
                Cancel
              </Button>
            ) : (
              <Button type="submit">Pull</Button>
            )}
          </div>
          {pulling && (
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <progress
                // Without a size, the bar shows that something is going on.
                max={pulling.total || undefined}
                value={pulling.total ? pulling.completed : undefined}
                aria-label={`Pulling ${pulling.model}`}
                className="h-1.5 w-40 accent-fg"
              />
              {pulling.total > 0 && (
                <span className="w-10 text-right font-mono tabular-nums">
                  {Math.round((pulling.completed / pulling.total) * 100)} %
                </span>
              )}
              <span role="status">{pulling.status}</span>
            </div>
          )}
          <ErrorMessage error={pullError} />
        </form>
      )}
      <Card className="max-w-2xl">
        {models.isPending ? (
          <EmptyState>
            <Spinner />
          </EmptyState>
        ) : models.data?.models.length ? (
          <ul ref={list} tabIndex={-1} className="divide-y divide-dotted divide-border text-sm">
            {models.data.models.map((m) => (
              <li
                key={`${m.provider}/${m.id}`}
                className="flex items-center justify-between px-4 py-2"
              >
                <span className="font-mono">{m.id}</span>
                <span className="flex items-center gap-2">
                  <span className="text-fg-muted">{m.provider}</span>
                  <Badge tone={m.kind === ModelKind.EMBEDDING ? "info" : "neutral"}>
                    {m.kind === ModelKind.EMBEDDING ? "embedding" : "chat"}
                  </Badge>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      disabled={remove.isPending}
                      aria-label={`Delete ${m.id}`}
                      onClick={() => setDeleting(m)}
                    >
                      Delete
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Cpu}>No models installed.</EmptyState>
        )}
      </Card>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete model?"
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
        fallbackFocus={list}
      >
        {deleting?.id} will be removed from {deleting?.provider}. Search, chat or processing that
        uses it stops working until it is pulled again.
      </ConfirmDialog>
    </div>
  );
}
