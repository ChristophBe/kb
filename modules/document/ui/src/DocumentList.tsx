import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { useClient, useCurrentUser, useQuery } from "@knowcel/module-sdk";
import {
  Badge,
  buttonClass,
  Card,
  ChunkStrip,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  formatBytes,
  formatTime,
  IconButton,
  Input,
  PageHeader,
  SkeletonRows,
} from "@knowcel/ui";
import { Download, FileText, Search as SearchIcon, Trash2, Upload } from "lucide-react";
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

const time = (d: { createTime?: { seconds: bigint; nanos: number } }) =>
  Number(d.createTime?.seconds ?? 0n) * 1e9 + (d.createTime?.nanos ?? 0);

export function DocumentList() {
  const client = useClient(DocumentService);
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: () => client.listDocuments({ page: { pageSize: 100 } }),
    refetchInterval: 5000,
  });
  const user = useCurrentUser();
  // Only the documents of others; the list holds the user's own, public ones and those of their teams.
  const [sharedOnly, setSharedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [titleFilter, setTitleFilter] = useState("");
  const needle = titleFilter.trim().toLowerCase();
  const shown = (docs.data?.documents ?? [])
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
        eyebrow="knowcelium / documents"
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
          className="w-64"
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
          <table ref={table} tabIndex={-1} aria-label="Documents" className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-fg-muted uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Chunks</th>
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
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      <ChunkStrip count={d.chunkCount} />
                    </td>
                    <td className="px-4 py-2 font-mono tabular-nums">{formatBytes(d.sizeBytes)}</td>
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
              ? "No documents match this title."
              : sharedOnly
                ? "No documents have been shared with you."
                : "No documents yet. Upload some to get started."}
          </EmptyState>
        )}
      </Card>
      <DeleteDocumentDialog
        document={deleting}
        onClose={() => setDeleting(null)}
        // After a delete, the row's button is gone; the focus stays in the list.
        fallbackFocus={table}
      />
    </div>
  );
}
