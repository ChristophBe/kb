import {
  DocumentService,
  DocumentStatus,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { Slot, useClient, useCurrentUser, useInfiniteQuery } from "@knowcel/module-sdk";
import {
  Badge,
  Button,
  brandText,
  buttonClass,
  Card,
  ChunkStrip,
  DelayedLoading,
  Download,
  EmptyState,
  ErrorMessage,
  FileText,
  formatBytes,
  formatTime,
  IconButton,
  Input,
  PageHeader,
  Search as SearchIcon,
  SkeletonRows,
  Trash2,
  Upload,
} from "@knowcel/ui";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { DeleteDocumentDialog, useDownloadDocument } from "./documentActions.tsx";
import { SharedWith } from "./SharedWith.tsx";
import { statusLabel } from "./status.ts";

const SORTS = {
  newest: "Newest first",
  oldest: "Oldest first",
  "title-asc": "Title A–Z",
  "title-desc": "Title Z–A",
} as const;
type Sort = keyof typeof SORTS;

export const DOCUMENT_PAGE_SIZE = 100;
/** Statuses that still change by themselves; the list polls while one is shown. */
const IN_FLIGHT = new Set([
  DocumentStatus.PENDING_UPLOAD,
  DocumentStatus.UPLOADED,
  DocumentStatus.PROCESSING,
]);
const POLL_MS = 5000;

const time = (d: { createTime?: { seconds: bigint; nanos: number } }) =>
  Number(d.createTime?.seconds ?? 0n) * 1e9 + (d.createTime?.nanos ?? 0);

export function DocumentList() {
  const client = useClient(DocumentService);
  // Pages load on demand; sorting and filtering work over every page loaded so far.
  const docs = useInfiniteQuery({
    queryKey: ["documents", "list"],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      client.listDocuments({ page: { pageSize: DOCUMENT_PAGE_SIZE, pageToken: pageParam } }),
    getNextPageParam: (last) => last.page?.nextPageToken || undefined,
    // Refetching reloads the pages shown, so it only runs while a document is still changing.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.documents.some((d) => IN_FLIGHT.has(d.status)))
        ? POLL_MS
        : false,
  });
  // With pages left, "no match" only speaks for the documents loaded so far.
  const more = docs.hasNextPage ? "loaded " : "";
  const loaded = docs.data?.pages.flatMap((p) => p.documents) ?? [];
  const user = useCurrentUser();
  // Only the documents of others; the list holds the user's own, public ones and those of their teams.
  const [sharedOnly, setSharedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [titleFilter, setTitleFilter] = useState("");
  const needle = titleFilter.trim().toLowerCase();
  const shown = loaded
    .filter((d) => !(sharedOnly && user) || d.ownerId !== user.id)
    .filter((d) => d.title.toLowerCase().includes(needle))
    .sort((a, b) => {
      switch (sort) {
        case "oldest":
          return time(a) - time(b);
        case "title-asc":
          return a.title.localeCompare(b.title);
        case "title-desc":
          return b.title.localeCompare(a.title);
        default:
          return time(b) - time(a);
      }
    });
  // The document the delete confirmation asks about.
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const download = useDownloadDocument();

  return (
    <div>
      <PageHeader
        eyebrow={brandText("knowcelium / documents")}
        title="Documents"
        description="Everything in your knowledge base."
        actions={
          <>
            <Link to="/search" className={buttonClass("secondary")}>
              <SearchIcon className="size-4" aria-hidden="true" /> Search
            </Link>
            <Link to="/m/ingestion" className={buttonClass("primary")}>
              <Upload className="size-4" aria-hidden="true" /> Upload documents
            </Link>
          </>
        }
      />
      <ErrorMessage error={docs.error} />
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Input
          type="search"
          aria-label="Filter by title"
          placeholder="Filter by title…"
          className="w-full sm:w-64"
          value={titleFilter}
          onChange={(e) => setTitleFilter(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-control border border-border-strong bg-surface px-2 py-1.5 text-sm hover:border-fg-muted"
          >
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {user && (
          <label className="flex min-h-6 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={sharedOnly}
              onChange={(e) => setSharedOnly(e.target.checked)}
            />
            Shared with me
          </label>
        )}
      </div>
      <Card>
        {docs.isPending ? (
          <DelayedLoading>
            <SkeletonRows label="Loading documents" />
          </DelayedLoading>
        ) : shown.length ? (
          <div className="overflow-x-auto">
            <table ref={table} tabIndex={-1} aria-label="Documents" className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-fg-muted uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Passages</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const [label, tone] = statusLabel[d.status];
                  return (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        <Link to={d.id} className="font-medium hover:underline">
                          {d.title}
                        </Link>
                        <div className="mt-1">
                          <SharedWith access={d.access} teamIds={d.teamIds} />
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge tone={tone}>{label}</Badge>
                          <Slot name="document.list.badges" documentId={d.id} />
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <ChunkStrip count={d.chunkCount} />
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {formatBytes(d.sizeBytes)}
                      </td>
                      <td className="px-4 py-2 font-mono text-fg-muted tabular-nums">
                        {formatTime(d.createTime)}
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        <IconButton label="Download" onClick={() => download(d.id)}>
                          <Download className="size-4" />
                        </IconButton>
                        {user?.id === d.ownerId && (
                          <IconButton label="Delete" tone="danger" onClick={() => setDeleting(d)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={FileText}
            action={
              !needle &&
              !sharedOnly && (
                <Link to="/m/ingestion" className={buttonClass("primary")}>
                  <Upload className="size-4" aria-hidden="true" /> Upload documents
                </Link>
              )
            }
          >
            {needle
              ? `No ${more}documents match this title.`
              : sharedOnly
                ? `No ${more}documents have been shared with you.`
                : "No documents yet. Upload some to get started."}
            {more && " Load more to look further."}
          </EmptyState>
        )}
      </Card>
      {docs.hasNextPage && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            variant="secondary"
            disabled={docs.isFetchingNextPage}
            onClick={async () => {
              const next = await docs.fetchNextPage();
              // The button is gone after the last page; keep the focus in the list.
              if (!next.hasNextPage) table.current?.focus();
            }}
          >
            {docs.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
          <span role="status" className="text-sm text-fg-muted">
            {loaded.length} documents loaded
          </span>
        </div>
      )}
      <DeleteDocumentDialog
        document={deleting}
        onClose={() => setDeleting(null)}
        // After a delete, the row's button is gone; the focus stays in the list.
        fallbackFocus={table}
      />
    </div>
  );
}
