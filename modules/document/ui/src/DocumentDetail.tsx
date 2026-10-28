import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { Badge, Card, ErrorMessage, formatBytes, formatTime, PageHeader, Spinner } from "@kb/ui";
import { Link, useParams } from "react-router";
import { statusLabel } from "./status.ts";

export function DocumentDetail() {
  const { id = "" } = useParams();
  const client = useClient(DocumentService);
  const doc = useQuery({ queryKey: ["documents", id], queryFn: () => client.getDocument({ id }) });

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
    ["Chunks", d.chunkCount],
    ["Created", formatTime(d.createTime)],
    ["Updated", formatTime(d.updateTime)],
    ["ID", <code className="text-xs">{d.id}</code>],
  ];
  return (
    <div>
      <Link to=".." relative="path" className="text-sm text-zinc-500 hover:underline">
        ← Documents
      </Link>
      <div className="mt-2">
        <PageHeader title={d.title} />
      </div>
      <Card className="max-w-2xl">
        <dl className="divide-y divide-zinc-100 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-3 gap-4 px-4 py-2">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="col-span-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
