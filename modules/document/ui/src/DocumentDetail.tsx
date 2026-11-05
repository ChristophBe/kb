import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { Badge, Card, ChunkStrip, ErrorMessage, formatBytes, formatTime, Spinner } from "@kb/ui";
import { Link, useLocation, useParams } from "react-router";
import { ChunkList } from "./ChunkList.tsx";
import { MetadataEditor } from "./MetadataEditor.tsx";
import { statusLabel } from "./status.ts";
import { TitleEditor } from "./TitleEditor.tsx";

export function DocumentDetail() {
  const { id = "" } = useParams();
  const client = useClient(DocumentService);
  const doc = useQuery({ queryKey: ["documents", id], queryFn: () => client.getDocument({ id }) });
  // A link to #chunk-<index> (e.g. from search) opens the list at that chunk.
  const target = /^#chunk-(\d+)$/.exec(useLocation().hash)?.[1];

  if (doc.isPending) return <Spinner />;
  if (doc.error) return <ErrorMessage error={doc.error} />;
  const d = doc.data.document;
  if (!d) return null;
  const [label, tone] = statusLabel[d.status];
  const rows: [string, React.ReactNode][] = [
    ["Status", <Badge tone={tone}>{label}</Badge>],
    ["Detail", d.statusDetail || "—"],
    ["Filename", d.filename],
    ["Content type", d.contentType],
    ["Size", formatBytes(d.sizeBytes)],
    ["Chunks", <ChunkStrip count={d.chunkCount} />],
    ["Created", formatTime(d.createTime)],
    ["Updated", formatTime(d.updateTime)],
    ["Metadata", <MetadataEditor id={d.id} metadata={d.metadata} />],
    ["ID", <code className="text-xs">{d.id}</code>],
  ];
  return (
    <div>
      <Link to=".." relative="path" className="text-sm text-fg-muted hover:underline">
        ← Documents
      </Link>
      <p className="mt-2 mb-2 font-mono text-xs text-fg-muted">kb / documents</p>
      <TitleEditor id={d.id} title={d.title} />
      <Card className="max-w-2xl">
        <dl className="divide-y divide-dotted divide-border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-3 gap-4 px-4 py-2">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="col-span-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <ChunkList
        documentId={d.id}
        chunkCount={d.chunkCount}
        status={d.status}
        statusDetail={d.statusDetail}
        focusIndex={target === undefined ? undefined : Number(target)}
      />
    </div>
  );
}
