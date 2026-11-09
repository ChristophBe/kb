import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { Badge, DelayedLoading, RelativeTime, SkeletonRows, Widget, WidgetMessage } from "@kb/ui";
import { FileText } from "lucide-react";
import { Link } from "react-router";
import { statusLabel } from "./status.ts";

/** How many documents the home page lists. */
const RECENT = 5;

/** Home-page widget: the documents added last, newest first. */
export function RecentDocuments() {
  const client = useClient(DocumentService);
  const docs = useQuery({
    // Under "documents", so that changes on the documents page refresh it too.
    queryKey: ["documents", "recent"],
    queryFn: () => client.listDocuments({ page: { pageSize: RECENT } }),
    refetchInterval: 10_000,
  });
  return (
    <Widget
      title="Recent documents"
      icon={FileText}
      action={
        <Link to="/m/document" className="font-medium text-accent hover:underline">
          All documents
        </Link>
      }
    >
      {docs.isPending ? (
        <DelayedLoading>
          <SkeletonRows label="Loading documents" rows={RECENT} />
        </DelayedLoading>
      ) : docs.isError ? (
        <WidgetMessage onRetry={() => docs.refetch()}>
          Your documents can't be loaded right now.
        </WidgetMessage>
      ) : docs.data.documents.length === 0 ? (
        <WidgetMessage>
          No documents yet.{" "}
          <Link to="/m/ingestion" className="font-medium text-accent hover:underline">
            Upload your first files
          </Link>
          .
        </WidgetMessage>
      ) : (
        <ul className="divide-y divide-dotted divide-border text-sm">
          {docs.data.documents.map((d) => {
            const [label, tone] = statusLabel[d.status];
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2">
                <Link
                  to={`/m/document/${d.id}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {d.title || d.filename}
                </Link>
                <RelativeTime time={d.createTime} className="shrink-0 text-xs text-fg-muted" />
                <Badge tone={tone}>{label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}
