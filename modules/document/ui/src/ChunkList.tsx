import {
  type Chunk,
  DocumentService,
  DocumentStatus,
} from "@kb/document-api/kb/document/v1/document_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { Button, Card, DelayedLoading, EmptyState, ErrorMessage, SkeletonRows } from "@kb/ui";
import { useEffect, useRef, useState } from "react";

export const CHUNK_PAGE_SIZE = 20;
/** Chunks longer than this start collapsed. */
const PREVIEW_CHARS = 400;

/** A document's chunks in index order, one page at a time. */
export function ChunkList({
  documentId,
  chunkCount,
  status,
  statusDetail,
}: {
  documentId: string;
  chunkCount: number;
  status: DocumentStatus;
  statusDetail: string;
}) {
  const client = useClient(DocumentService);
  // Tokens of the pages visited so far; the last one is the current page.
  const [tokens, setTokens] = useState([""]);
  const page = tokens.length - 1;
  const token = tokens[page] ?? "";
  const chunks = useQuery({
    queryKey: ["documents", documentId, "chunks", token],
    queryFn: () =>
      client.listChunks({ documentId, page: { pageSize: CHUNK_PAGE_SIZE, pageToken: token } }),
    placeholderData: (previous) => previous,
  });
  const firstHeading = useRef<HTMLHeadingElement>(null);
  // After Previous/Next, focus moves to the first chunk once its page has loaded.
  const focusPage = useRef<string | null>(null);
  useEffect(() => {
    if (focusPage.current === token && !chunks.isPlaceholderData) {
      firstHeading.current?.focus();
      focusPage.current = null;
    }
  }, [token, chunks.isPlaceholderData]);
  const go = (next: string[]) => {
    focusPage.current = next.at(-1) ?? "";
    setTokens(next);
  };

  const items = chunks.data?.chunks ?? [];
  const nextToken = chunks.data?.page?.nextPageToken ?? "";
  const first = page * CHUNK_PAGE_SIZE + 1;
  const last = page * CHUNK_PAGE_SIZE + items.length;

  let body: React.ReactNode;
  if (chunks.isPending) {
    body = (
      <DelayedLoading>
        <SkeletonRows label="Loading chunks" />
      </DelayedLoading>
    );
  } else if (chunks.error) {
    body = (
      <div className="p-4">
        <ErrorMessage error={chunks.error} />
        <Button variant="secondary" className="mt-3" onClick={() => chunks.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState>
        {status === DocumentStatus.FAILED
          ? `Processing failed${statusDetail ? `: ${statusDetail}` : "."}`
          : "This document has no chunks yet. They appear once processing has finished."}
      </EmptyState>
    );
  } else {
    body = (
      <div className="divide-y divide-dotted divide-border">
        {items.map((c, i) => (
          <ChunkItem key={c.index} chunk={c} headingRef={i === 0 ? firstHeading : undefined} />
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby="chunks-heading" className="mt-8 max-w-2xl">
      <h2 id="chunks-heading" className="mb-3 text-lg font-medium">
        Chunks <span className="font-mono text-sm text-fg-muted tabular-nums">({chunkCount})</span>
      </h2>
      <Card aria-busy={chunks.isFetching || undefined}>{body}</Card>
      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p role="status" className="font-mono text-xs text-fg-muted tabular-nums">
            Showing {first}–{last} of {Math.max(chunkCount, last)}
          </p>
          {(page > 0 || nextToken) && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={page === 0 || chunks.isPlaceholderData}
                onClick={() => go(tokens.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={!nextToken || chunks.isPlaceholderData}
                onClick={() => go([...tokens, nextToken])}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ChunkItem({
  chunk,
  headingRef,
}: {
  chunk: Chunk;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { page, heading, ...rest } = chunk.metadata;
  const details = [
    page && `page ${page}`,
    heading,
    ...Object.entries(rest).map(([k, v]) => `${k}: ${v}`),
    `${chunk.text.length} characters`,
  ].filter(Boolean);
  const long = chunk.text.length > PREVIEW_CHARS;
  const textId = `chunk-${chunk.index}-text`;
  return (
    <article id={`chunk-${chunk.index}`} className="grid grid-cols-[3rem_1fr] gap-2 px-4 py-3">
      <h3 ref={headingRef} tabIndex={-1} className="font-mono text-sm text-fg-muted tabular-nums">
        <span aria-hidden="true">#{chunk.index + 1}</span>
        <span className="sr-only">Chunk {chunk.index + 1}</span>
      </h3>
      <div className="min-w-0">
        <p className="font-mono text-xs wrap-anywhere text-fg-muted">{details.join(" · ")}</p>
        <p
          id={textId}
          className={`mt-1 text-sm wrap-anywhere whitespace-pre-wrap ${long && !expanded ? "line-clamp-4" : ""}`}
        >
          {chunk.text}
        </p>
        {long && (
          <Button
            variant="ghost"
            className="mt-1 -ml-3"
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : "Show full chunk"}
          </Button>
        )}
      </div>
    </article>
  );
}
