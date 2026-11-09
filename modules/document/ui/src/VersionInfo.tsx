import { type Document, DocumentStatus } from "@kb/document-api/kb/document/v1/document_pb";
import { Badge, buttonClass } from "@kb/ui";
import { Upload } from "lucide-react";
import { Link } from "react-router";
import { statusLabel } from "./status.ts";

const busy = new Set([
  DocumentStatus.PENDING_UPLOAD,
  DocumentStatus.UPLOADED,
  DocumentStatus.PROCESSING,
]);

/** Whether the document or its new version is on its way through upload and processing. */
export function inProgress(d: Document): boolean {
  const pending = d.pendingVersion?.status;
  return (
    busy.has(d.status) ||
    pending === DocumentStatus.UPLOADED ||
    pending === DocumentStatus.PROCESSING
  );
}

/**
 * The document's version, the state of a new version on its way, and the link to upload
 * one. Uploading happens in ingestion, like any upload; the document keeps its current
 * version until the new one is ready.
 */
export function VersionInfo({ document: d }: { document: Document }) {
  const pending = d.pendingVersion;
  const canReplace = !inProgress(d);
  return (
    <div className="flex flex-col items-start gap-2">
      <span>{d.version}</span>
      {pending && (
        <PendingVersion
          version={pending.version}
          status={pending.status}
          filename={pending.filename}
          detail={pending.statusDetail}
        />
      )}
      {canReplace && (
        <Link
          to={`/m/ingestion/replace/${d.id}`}
          state={{ title: d.title }}
          className={buttonClass("secondary")}
        >
          <Upload className="size-4" aria-hidden="true" /> Upload new version
        </Link>
      )}
    </div>
  );
}

function PendingVersion({
  version,
  status,
  filename,
  detail,
}: {
  version: number;
  status: DocumentStatus;
  filename: string;
  detail: string;
}) {
  const [label, tone] = statusLabel[status];
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        Version {version} ({filename}):
      </span>
      <Badge tone={tone}>{label}</Badge>
      {status === DocumentStatus.FAILED && detail && <span className="text-danger">{detail}</span>}
    </span>
  );
}
