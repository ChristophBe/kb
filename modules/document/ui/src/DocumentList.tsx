import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import { useClient, useMutation, useQuery, useQueryClient } from "@kb/module-sdk";
import {
  Badge,
  Button,
  Card,
  ChunkStrip,
  EmptyState,
  ErrorMessage,
  formatBytes,
  formatTime,
  PageHeader,
  Spinner,
} from "@kb/ui";
import { Download, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { statusLabel } from "./status.ts";

export function DocumentList() {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: () => client.listDocuments({ page: { pageSize: 100 } }),
    refetchInterval: 5000,
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteDocument({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
  const download = async (id: string) => {
    const { url } = await client.getDownloadUrl({ id });
    window.open(url, "_blank");
  };

  return (
    <div>
      <PageHeader
        eyebrow="kb / documents"
        title="Documents"
        description="Everything in your knowledge base."
      />
      <ErrorMessage error={docs.error ?? remove.error} />
      <Card>
        {docs.isPending ? (
          <EmptyState>
            <Spinner />
          </EmptyState>
        ) : docs.data?.documents.length ? (
          <table className="w-full text-sm">
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
              {docs.data.documents.map((d) => {
                const [label, tone] = statusLabel[d.status];
                return (
                  <tr key={d.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Link to={d.id} className="font-medium hover:underline">
                        {d.title}
                      </Link>
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
                      <Button variant="ghost" title="Download" onClick={() => download(d.id)}>
                        <Download className="size-4" />
                      </Button>
                      <Button variant="danger" title="Delete" onClick={() => remove.mutate(d.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState>No documents yet. Upload some in Ingestion.</EmptyState>
        )}
      </Card>
    </div>
  );
}
