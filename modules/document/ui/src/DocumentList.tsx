import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import {
  toast,
  useClient,
  useCurrentUser,
  useMutation,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import {
  Badge,
  buttonClass,
  Card,
  ChunkStrip,
  ConfirmDialog,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  formatBytes,
  formatTime,
  IconButton,
  PageHeader,
  SkeletonRows,
} from "@knowcel/ui";
import { Download, FileText, Search as SearchIcon, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { SharedWith } from "./SharedWith.tsx";
import { statusLabel } from "./status.ts";

export function DocumentList() {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: () => client.listDocuments({ page: { pageSize: 100 } }),
    refetchInterval: 5000,
  });
  const user = useCurrentUser();
  // Only the documents others have shared; the list holds the user's own and those.
  const [sharedOnly, setSharedOnly] = useState(false);
  const shown = (docs.data?.documents ?? []).filter(
    (d) => !(sharedOnly && user) || d.ownerId !== user.id,
  );
  // The document the delete confirmation asks about.
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteDocument({ id }),
    onSuccess: () => {
      toast.success("Document deleted");
      return queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
  const confirmDelete = (id: string) =>
    remove.mutate(id, {
      onSettled: () => setDeleting(null),
    });
  const download = async (id: string) => {
    const { url } = await client.getDownloadUrl({ id });
    window.open(url, "_blank");
  };

  return (
    <div>
      <PageHeader
        eyebrow="knowcelium / documents"
        title="Documents"
        description="Everything in your knowledge base."
        actions={
          <Link to="/search" className={buttonClass("secondary")}>
            <SearchIcon className="size-4" aria-hidden="true" /> Search
          </Link>
        }
      />
      <ErrorMessage error={docs.error ?? remove.error} />
      {user && (
        <label className="mb-3 flex w-fit min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={sharedOnly}
            onChange={(e) => setSharedOnly(e.target.checked)}
          />
          Shared with me
        </label>
      )}
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
                      <IconButton label="Delete" tone="danger" onClick={() => setDeleting(d)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={FileText}>
            {sharedOnly
              ? "No documents have been shared with you."
              : "No documents yet. Upload some in Ingestion."}
          </EmptyState>
        )}
      </Card>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete document?"
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && confirmDelete(deleting.id)}
        onCancel={() => setDeleting(null)}
        // After a delete, the row's button is gone; the focus stays in the list.
        fallbackFocus={table}
      >
        “{deleting?.title}” and its passages will be deleted. Chat can no longer use them. This
        can't be undone.
      </ConfirmDialog>
    </div>
  );
}
