import {
  type Chunk,
  DocumentService,
  DocumentStatus,
} from "@kb/document-api/kb/document/v1/document_pb";
import { useClient, useQuery, useQueryClient } from "@kb/module-sdk";
import { Button, Card, DelayedLoading, EmptyState, ErrorMessage, SkeletonRows } from "@kb/ui";
import { useEffect, useRef, useState } from "react";

export const CHUNK_PAGE_SIZE = 20;
/** Chunks longer than this start collapsed. */
const PREVIEW_CHARS = 400;

/** How long a chunk opened by a deep link stays highlighted. */
const HIGHLIGHT_MS = 2000;

/**
 * A document's chunks in index order, one page at a time. With `focusIndex`
 * (from a `#chunk-<index>` link) it opens the page holding that chunk, scrolls
 * to it, highlights it briefly and focuses its heading.
 */
export function ChunkList({
  documentId,
  chunkCount,
  status,
  statusDetail,
  focusIndex,
}: {
  documentId: string;
  chunkCount: number;
  status: DocumentStatus;
  statusDetail: string;
  focusIndex?: number;
}) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  // Tokens of the pages visited so far; the last one is the current page.
  const [tokens, setTokens] = useState([""]);
  const page = tokens.length - 1;
  const token = tokens[page] ?? "";
  const pageQuery = (pageToken: string) => ({
    queryKey: ["documents", documentId, "chunks", pageToken],
    queryFn: () =>
      client.listChunks({ documentId, page: { pageSize: CHUNK_PAGE_SIZE, pageToken } }),
  });
  const chunks = useQuery({ ...pageQuery(token), placeholderData: (previous) => previous });
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

  // Page tokens are opaque, so the page holding the target is found by
  // walking the pages from the start; they stay cached for Previous.
  const target = useRef<number | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageQuery only depends on documentId and the client.
  useEffect(() => {
    if (focusIndex === undefined) return;
    let cancelled = false;
    (async () => {
      const path = [""];
      for (;;) {
        const data = await queryClient.fetchQuery(pageQuery(path.at(-1) ?? ""));
        const next = data.page?.nextPageToken ?? "";
        if ((data.chunks.at(-1)?.index ?? -1) >= focusIndex || !next) break;
        path.push(next);
      }
      if (cancelled) return;
      target.current = focusIndex;
      setTokens(path);
    })().catch(() => {
      // The page query shows the error.
    });
    return () => {
      cancelled = true;
    };
  }, [focusIndex, documentId, queryClient]);
  const items = chunks.data?.chunks ?? [];
  useEffect(() => {
    const index = target.current;
    if (index === null || chunks.isPlaceholderData || !items.some((c) => c.index === index)) return;
    target.current = null;
    const el = document.getElementById(`chunk-${index}`);
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView?.({ block: "center", behavior: smooth ? "smooth" : "auto" });
    el?.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
    setHighlighted(index);
  }, [items, chunks.isPlaceholderData]);
  useEffect(() => {
    if (highlighted === null) return;
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

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
          <ChunkItem
            key={c.index}
            chunk={c}
            headingRef={i === 0 ? firstHeading : undefined}
            highlighted={c.index === highlighted}
          />
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
  highlighted = false,
}: {
  chunk: Chunk;
  headingRef?: React.Ref<HTMLHeadingElement>;
  highlighted?: boolean;
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
    <article
      id={`chunk-${chunk.index}`}
      data-highlighted={highlighted || undefined}
      className={`grid scroll-mt-4 grid-cols-[3rem_1fr] gap-2 px-4 py-3 transition-colors duration-700 ${highlighted ? "bg-info-subtle" : ""}`}
    >
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
