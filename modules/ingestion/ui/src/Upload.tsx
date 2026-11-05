import {
  IngestionService,
  type Job,
  JobStatus,
} from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { toast, useClient, useQuery, useQueryClient } from "@kb/module-sdk";
import {
  Badge,
  Button,
  Card,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  formatTime,
  PageHeader,
  SkeletonRows,
  type Tone,
} from "@kb/ui";
import { AlertTriangle, Upload as UploadIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUPPORTED_FORMATS } from "./files.ts";
import { putWithProgress } from "./put.ts";
import { type Upload as UploadRow, useUploads } from "./useUploads.ts";

const statusLabel: Record<JobStatus, [string, Tone]> = {
  [JobStatus.UNSPECIFIED]: ["Unknown", "neutral"],
  [JobStatus.PENDING_UPLOAD]: ["Uploading", "neutral"],
  [JobStatus.QUEUED]: ["Queued", "info"],
  [JobStatus.PROCESSING]: ["Processing", "warning"],
  [JobStatus.DONE]: ["Done", "success"],
  [JobStatus.FAILED]: ["Failed", "danger"],
};

/** A local status region: progress is not announced continuously, state changes once. */
function useAnnouncer() {
  const [polite, setPolite] = useState("");
  const [urgent, setUrgent] = useState("");
  const announce = useCallback((message: string, isUrgent = false) => {
    const set = isUrgent ? setUrgent : setPolite;
    // Clearing first makes screen readers repeat an identical message.
    set("");
    setTimeout(() => set(message), 50);
  }, []);
  const regions = (
    <>
      <p role="status" className="sr-only">
        {polite}
      </p>
      <p role="alert" className="sr-only">
        {urgent}
      </p>
    </>
  );
  return { announce, regions };
}

export function Upload() {
  const client = useClient(IngestionService);
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const { announce, regions } = useAnnouncer();
  const jobs = useQuery({
    queryKey: ["ingestion-jobs"],
    queryFn: () => client.listJobs({ page: { pageSize: 50 } }),
  });

  const events = useMemo(
    () => ({
      onJob: (job: Job) =>
        queryClient.setQueryData(["ingestion-jobs"], (old: typeof jobs.data) =>
          old ? { ...old, jobs: [job, ...old.jobs.filter((j) => j.id !== job.id)] } : old,
        ),
      announce,
      notify: (message: string, failed: boolean) =>
        failed ? toast.error(message) : toast.success(message),
      error: (message: string) => toast.error(message),
    }),
    [queryClient, announce],
  );
  const { uploads, abandonedJobs, reprocessing, add, retry, remove, reprocess } = useUploads(
    client,
    putWithProgress,
    events,
  );

  // Focus moves once the rows have rendered: to a row control, or back to "Choose files".
  useEffect(() => {
    if (focusAfter === null) return;
    const target =
      focusAfter === "choose"
        ? chooseButton.current
        : list.current?.querySelector<HTMLElement>(`[data-focus="${focusAfter}"]`);
    (target ?? chooseButton.current)?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  // A finished upload hands its row over to the job, which has no controls yet; if
  // focus was in that row, it would fall back to the page.
  const lastFocusedRow = useRef<string | null>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onFocusIn = (e: FocusEvent) => {
      lastFocusedRow.current =
        (e.target as HTMLElement)
          .closest("li")
          ?.querySelector("[data-focus]")
          ?.getAttribute("data-focus") ?? null;
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  });
  useEffect(() => {
    const row = lastFocusedRow.current;
    if (!row || uploads.some((u) => `upload-${u.key}` === row)) return;
    lastFocusedRow.current = null;
    if (document.activeElement === document.body) chooseButton.current?.focus();
  }, [uploads]);

  const removeRow = (key: number) => {
    const next = uploads[uploads.findIndex((u) => u.key === key) + 1];
    remove(key);
    setFocusAfter(next ? `upload-${next.key}` : "choose");
  };

  const shownJobs = jobs.data?.jobs.filter((j) => !abandonedJobs.has(j.id)) ?? [];
  const empty = uploads.length === 0 && shownJobs.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow="kb / ingestion"
        title="Ingestion"
        description="Upload documents to add them to the knowledge base."
      />
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: drag and drop is a pointer shortcut; keyboard users use "Choose files". */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same reason. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(Array.from(e.dataTransfer.files));
        }}
        className={`mb-6 flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-border-strong p-10 text-sm text-fg-muted ${dragging ? "bg-surface-muted" : "bg-surface"}`}
      >
        <UploadIcon className="size-6" aria-hidden="true" />
        {dragging ? (
          <span>Drop to upload</span>
        ) : (
          <span className="flex items-center gap-2">
            Drop files here or
            <Button
              ref={chooseButton}
              variant="secondary"
              onClick={() => fileInput.current?.click()}
            >
              Choose files
            </Button>
          </span>
        )}
        <span>{SUPPORTED_FORMATS}</span>
        <input
          ref={fileInput}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {regions}
      <h2 className="mb-2 font-medium">Uploads</h2>
      <ErrorMessage error={jobs.error} />
      <Card>
        {jobs.isPending && uploads.length === 0 ? (
          <DelayedLoading>
            <SkeletonRows label="Loading uploads" />
          </DelayedLoading>
        ) : empty ? (
          <EmptyState>No uploads yet. Drop files above to add documents.</EmptyState>
        ) : (
          <ul ref={list} className="divide-y divide-dotted divide-border text-sm">
            {uploads.map((u) => (
              <UploadItem
                key={u.key}
                upload={u}
                onRetry={() => {
                  retry(u.key);
                  setFocusAfter(`upload-${u.key}`);
                }}
                onRemove={() => removeRow(u.key)}
              />
            ))}
            {shownJobs.map((job) => {
              const [label, tone] = statusLabel[job.status];
              return (
                <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                  {/* Focus lands here once "Retry processing" has been replaced by the status. */}
                  <span
                    tabIndex={-1}
                    data-focus={`job-${job.id}`}
                    className="min-w-0 flex-1 truncate font-medium"
                  >
                    {job.filename}
                  </span>
                  {job.status === JobStatus.DONE && (
                    <span className="text-fg-muted">{job.chunkCount} chunks</span>
                  )}
                  {job.error && <span className="truncate text-danger">{job.error}</span>}
                  {job.status === JobStatus.FAILED && (
                    // aria-disabled, not disabled: a disabled button would drop focus,
                    // which stays here when the request fails.
                    <Button
                      variant="secondary"
                      aria-disabled={reprocessing.has(job.id)}
                      onClick={async () => {
                        if (await reprocess(job)) setFocusAfter(`job-${job.id}`);
                      }}
                    >
                      Retry processing
                    </Button>
                  )}
                  <span className="font-mono text-fg-muted tabular-nums">
                    {formatTime(job.createTime)}
                  </span>
                  <Badge tone={tone}>{label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UploadItem({
  upload,
  onRetry,
  onRemove,
}: {
  upload: UploadRow;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const { key, file, status, progress, error } = upload;
  const percent = Math.round(progress * 100);
  const removeLabel =
    status === "uploading" || status === "waiting"
      ? `Cancel upload of ${file.name}`
      : `Dismiss ${file.name}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
      <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
      {status === "waiting" && <span className="text-fg-muted">Waiting</span>}
      {status === "uploading" && (
        <span className="flex items-center gap-2">
          <progress
            max={100}
            value={percent}
            aria-label={`Uploading ${file.name}`}
            className="h-1.5 w-40 accent-fg"
          />
          <span className="w-10 text-right font-mono text-fg-muted tabular-nums">{percent} %</span>
        </span>
      )}
      {(status === "failed" || status === "rejected") && (
        <span className="flex items-center gap-1.5 text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {status === "failed" ? `Upload failed: ${error}` : error}
        </span>
      )}
      {status === "failed" && (
        <Button variant="secondary" onClick={onRetry}>
          Retry upload
        </Button>
      )}
      <Button
        variant="ghost"
        aria-label={removeLabel}
        data-focus={`upload-${key}`}
        onClick={onRemove}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}
