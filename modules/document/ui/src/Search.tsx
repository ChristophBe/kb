import { DocumentService, type ScoredChunk } from "@kb/document-api/kb/document/v1/document_pb";
import { Code, ConnectError, useClient, useQuery } from "@kb/module-sdk";
import {
  Button,
  Card,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  SkeletonRows,
} from "@kb/ui";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

export const SEARCH_LIMIT = 20;

/** Semantic search over all chunks; the query lives in `?q=`, so results are linkable. */
export function Search() {
  const client = useClient(DocumentService);
  const [params, setParams] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const [draft, setDraft] = useState(q);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  // Back and Forward change the URL; the field follows.
  useEffect(() => setDraft(q), [q]);

  const results = useQuery({
    queryKey: ["documents", "search", q],
    queryFn: () => client.searchDocuments({ query: q, limit: SEARCH_LIMIT }),
    enabled: q !== "",
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = draft.trim();
    if (!query) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    setInvalid(false);
    setParams({ q: query });
  };

  const items = results.data?.results ?? [];
  let announcement = "";
  if (q && results.isFetching) announcement = "Searching…";
  else if (q && results.isSuccess)
    announcement = `${items.length} ${items.length === 1 ? "result" : "results"} for "${q}"`;

  let body: React.ReactNode = null;
  if (!q) {
    body = null;
  } else if (results.isPending) {
    body = (
      <Card>
        <DelayedLoading>
          <SkeletonRows label="Searching" />
        </DelayedLoading>
      </Card>
    );
  } else if (results.error) {
    body = <ErrorMessage error={readableError(results.error)} />;
  } else if (items.length === 0) {
    body = (
      <Card>
        <EmptyState>No passages match "{q}". Try other words.</EmptyState>
      </Card>
    );
  } else {
    body = (
      <Card aria-busy={results.isFetching || undefined}>
        <ol className="divide-y divide-dotted divide-border">
          {items.map((r) => (
            <Result key={`${r.chunk?.documentId}-${r.chunk?.index}`} result={r} />
          ))}
        </ol>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="kb / documents / search"
        title="Search"
        description="Find passages across all documents."
      />
      <search className="mb-4 block">
        <form noValidate onSubmit={submit}>
          <label htmlFor={`${errorId}-q`} className="sr-only">
            Search documents
          </label>
          <div className="flex gap-2">
            <Input
              ref={input}
              id={`${errorId}-q`}
              type="search"
              placeholder="Search documents"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (invalid && e.target.value.trim()) setInvalid(false);
              }}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
            />
            <Button type="submit">Search</Button>
          </div>
          {invalid && (
            <p id={errorId} className="mt-1 text-sm text-danger">
              Enter a search term
            </p>
          )}
        </form>
      </search>
      <p role="status" className="mb-3 font-mono text-xs text-fg-muted">
        {announcement}
      </p>
      {body}
    </div>
  );
}

function Result({ result }: { result: ScoredChunk }) {
  const chunk = result.chunk;
  if (!chunk) return null;
  const n = chunk.index + 1;
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="min-w-0 text-sm font-medium wrap-anywhere">
          <Link
            to={{ pathname: `../${chunk.documentId}`, hash: `chunk-${chunk.index}` }}
            relative="path"
            className="hover:underline"
          >
            {result.documentTitle}
            <span aria-hidden="true"> · chunk {n}</span>
            <span className="sr-only">, chunk {n}</span>
          </Link>
        </h2>
        <span className="shrink-0 font-mono text-xs text-fg-muted tabular-nums">
          <span className="sr-only">relevance </span>
          {result.score.toFixed(2)}
        </span>
      </div>
      <p className="mt-1 line-clamp-3 text-sm wrap-anywhere text-fg-muted">{chunk.text}</p>
    </li>
  );
}

/** What went wrong, without the raw status. */
function readableError(err: unknown): string {
  const code = err instanceof ConnectError ? err.code : Code.Unknown;
  switch (code) {
    case Code.Unavailable:
      return "Search needs the Models service, which isn't available right now.";
    case Code.InvalidArgument:
      return "Enter a search term";
    default:
      return "Search failed. Try again.";
  }
}
