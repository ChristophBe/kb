import {
  type Document,
  DocumentStatus,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { Badge, buttonClass } from "@knowcel/ui";
import { AlertTriangle, Upload } from "lucide-react";
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

/** The document's version and the state of a new version on its way. */
export function VersionInfo({ document: d }: { document: Document }) {
  const pending = d.pendingVersion;
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

/**
 * The link to upload a new version, nothing while the document or a new version is
 * processed. Uploading happens in ingestion, like any upload; the document keeps its
 * current version until the new one is ready.
 */
export function UploadVersionLink({ document: d }: { document: Document }) {
  if (inProgress(d)) return null;
  return (
    <Link
      to={`/m/ingestion/replace/${d.id}`}
      state={{ title: d.title }}
      className={buttonClass("secondary")}
    >
      <Upload className="size-4" aria-hidden="true" /> Upload new version
    </Link>
  );
}

/**
 * What went wrong when the document, or the new version on its way, failed to process, and the
 * way to try again: the job lives in ingestion, which lists it with "Retry processing".
 * Nothing while neither failed.
 */
export function FailureNotice({ document: d }: { document: Document }) {
  const failed = d.status === DocumentStatus.FAILED;
  const pending = d.pendingVersion;
  const pendingFailed = pending?.status === DocumentStatus.FAILED;
  if (!failed && !pendingFailed) return null;
  return (
    <div
      role="alert"
      className="mb-6 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-control bg-danger-subtle px-3 py-2 text-sm text-danger"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {failed && (
          <p>
            Processing failed{d.statusDetail ? `: ${d.statusDetail}` : ""}. The document can't be
            searched until it is processed again.
          </p>
        )}
        {pendingFailed && (
          <p>
            Version {pending.version} ({pending.filename}) failed
            {pending.statusDetail ? `: ${pending.statusDetail}` : ""}. The document keeps its
            current version.
          </p>
        )}
      </div>
      <Link to={`/m/ingestion?document=${d.id}`} className={buttonClass("secondary")}>
        View job and retry processing
      </Link>
    </div>
  );
}
