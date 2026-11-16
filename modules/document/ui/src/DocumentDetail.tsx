import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import {
  Code,
  ConnectError,
  useClient,
  useCurrentUser,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  ChunkStrip,
  DelayedLoading,
  ErrorMessage,
  formatBytes,
  formatTime,
  Skeleton,
  SkeletonRows,
} from "@knowcel/ui";
import { Download, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { AccessEditor } from "./AccessEditor.tsx";
import { ChunkList } from "./ChunkList.tsx";
import { DeleteDocumentDialog, useDownloadDocument } from "./documentActions.tsx";
import { MetadataEditor } from "./MetadataEditor.tsx";
import { OwnerName } from "./OwnerName.tsx";
import { SharedWith } from "./SharedWith.tsx";
import { ShareEditor } from "./ShareEditor.tsx";
import { statusLabel } from "./status.ts";
import { TitleEditor } from "./TitleEditor.tsx";
import { inProgress, UploadVersionLink, VersionInfo } from "./VersionInfo.tsx";

/** How often the page refreshes while the document or a new version is processed. */
const PROCESSING_REFRESH_MS = 3000;

const BACK = (
  <Link to=".." relative="path" className="text-sm text-fg-muted hover:underline">
    ← Documents
  </Link>
);

/** What a failed load means for the user; the service answers NOT_FOUND to those without access too. */
function loadError(err: unknown): Error {
  const code = ConnectError.from(err).code;
  if (code === Code.NotFound || code === Code.PermissionDenied) {
    return new Error("This document doesn't exist, was deleted, or you don't have access to it.");
  }
  if (code === Code.Unavailable) {
    return new Error("Documents are not available right now. Try again in a moment.");
  }
  return ConnectError.from(err);
}

export function DocumentDetail() {
  const { id = "" } = useParams();
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const download = useDownloadDocument();
  const [deleting, setDeleting] = useState(false);
  const doc = useQuery({
    queryKey: ["documents", id],
    queryFn: () => client.getDocument({ id }),
    refetchInterval: (query) => {
      const d = query.state.data?.document;
      return d && inProgress(d) ? PROCESSING_REFRESH_MS : false;
    },
  });
  // A new version brings new chunks.
  const version = doc.data?.document?.version;
  const shownVersion = useRef(version);
  useEffect(() => {
    if (shownVersion.current !== undefined && version !== shownVersion.current) {
      void queryClient.invalidateQueries({ queryKey: ["documents", id, "chunks"] });
    }
    shownVersion.current = version;
  }, [queryClient, id, version]);
  // A link to #chunk-<index> (e.g. from search) opens the list at that chunk.
  const target = /^#chunk-(\d+)$/.exec(useLocation().hash)?.[1];

  if (doc.isPending) {
    return (
      <div>
        {BACK}
        <DelayedLoading>
          <Skeleton className="mt-6 mb-8 h-9 w-1/2" />
          <Card className="max-w-2xl">
            <SkeletonRows label="Loading document" rows={6} />
          </Card>
        </DelayedLoading>
      </div>
    );
  }
  if (doc.error) {
    return (
      <div className="space-y-4">
        {BACK}
        <ErrorMessage error={loadError(doc.error)} />
        <Link to=".." relative="path" className={buttonClass("secondary")}>
          Back to Documents
        </Link>
      </div>
    );
  }
  const d = doc.data.document;
  if (!d) return null;
  const isOwner = user?.id === d.ownerId;
  const [label, tone] = statusLabel[d.status];
  const rows: [string, React.ReactNode][] = [
    ["Status", <Badge tone={tone}>{label}</Badge>],
    ["Detail", d.statusDetail || "—"],
    ["Version", <VersionInfo document={d} />],
    ["Filename", d.filename],
    ["Content type", d.contentType],
    ["Size", formatBytes(d.sizeBytes)],
    ["Chunks", <ChunkStrip count={d.chunkCount} />],
    ["Owner", isOwner ? "You" : <OwnerName ownerId={d.ownerId} teamIds={d.teamIds} />],
    [
      "Access",
      isOwner ? <SharedWith access={d.access} teamIds={d.teamIds} /> : <ShareEditor document={d} />,
    ],
    ["Created", formatTime(d.createTime)],
    ["Updated", formatTime(d.updateTime)],
    ["Metadata", <MetadataEditor id={d.id} metadata={d.metadata} />],
    ["ID", <code className="text-xs">{d.id}</code>],
  ];
  return (
    <div>
      {BACK}
      <p className="mt-2 mb-2 font-mono text-xs text-fg-muted">knowcelium / documents</p>
      <TitleEditor id={d.id} title={d.title} />
      <div role="toolbar" aria-label="Document actions" className="-mt-4 mb-6 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => download(d.id)}>
          <Download className="size-4" aria-hidden="true" /> Download
        </Button>
        <UploadVersionLink document={d} />
        {isOwner && <AccessEditor document={d} />}
        {isOwner && (
          <Button variant="danger" onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </Button>
        )}
      </div>
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
      <DeleteDocumentDialog
        document={deleting ? d : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => navigate("..", { relative: "path" })}
      />
    </div>
  );
}
