import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import {
  Badge,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  RelativeTime,
  SkeletonRows,
  WidgetCard,
} from "@kb/ui";
import { FileText } from "lucide-react";
import { Link } from "react-router";
import { statusLabel } from "./status.ts";

const RECENT = 5;

/** Home widget: the latest documents with their status, so returning users can open one. */
export function RecentDocuments() {
  const client = useClient(DocumentService);
  const docs = useQuery({
    queryKey: ["documents", "recent"],
    queryFn: () => client.listDocuments({ page: { pageSize: RECENT } }),
  });
  const items = docs.data?.documents.slice(0, RECENT) ?? [];
  return (
    <WidgetCard
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
      ) : docs.error ? (
        <div className="p-4">
          <ErrorMessage error="Documents are not available right now. Try again in a moment." />
        </div>
      ) : items.length ? (
        <ul className="divide-y divide-dotted divide-border">
          {items.map((d) => {
            const [label, tone] = statusLabel[d.status];
            return (
              <li key={d.id}>
                <Link
                  to={`/m/document/${d.id}`}
                  className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface-muted"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                  <Badge tone={tone}>{label}</Badge>
                  <RelativeTime ts={d.createTime} className="w-24 shrink-0 text-right" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>
          No documents yet.{" "}
          <Link to="/m/ingestion" className="font-medium text-accent hover:underline">
            Upload one to get started.
          </Link>
        </EmptyState>
      )}
    </WidgetCard>
  );
}
