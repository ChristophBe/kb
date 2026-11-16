import {
  IngestionService,
  type Job,
  JobStatus,
} from "@knowcel/ingestion-api/knowcel/ingestion/v1/ingestion_pb";
import { toast, useClient, useQuery, useQueryClient } from "@knowcel/module-sdk";
import {
  type AccessChoice,
  AccessPicker,
  Badge,
  Button,
  Card,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  formatTime,
  IconButton,
  isValidAccess,
  PageHeader,
  PUBLIC_ACCESS,
  SkeletonRows,
  type Tone,
} from "@knowcel/ui";
import { AlertTriangle, FileUp, Upload as UploadIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUPPORTED_FORMATS } from "./files.ts";
import { active, ProgressBar, stageLabel } from "./progress.tsx";
import { putWithProgress } from "./put.ts";
import { useMyTeams } from "./useMyTeams.ts";
import { type Upload as UploadRow, useUploads } from "./useUploads.ts";

const statusLabel: Record<JobStatus, [string, Tone]> = {
  [JobStatus.UNSPECIFIED]: ["Unknown", "neutral"],
  [JobStatus.PENDING_UPLOAD]: ["Uploading", "neutral"],
  [JobStatus.QUEUED]: ["Queued", "info"],
  [JobStatus.PROCESSING]: ["Processing", "warning"],
  [JobStatus.DONE]: ["Done", "success"],
  [JobStatus.FAILED]: ["Failed", "danger"],
};

/** How often the list refreshes while a job is being processed, for jobs no upload of this page watches. */
const ACTIVE_REFRESH_MS = 3000;

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
  // Added files wait here until the user has confirmed who can read them.
  const { teams } = useMyTeams();
  const [staged, setStaged] = useState<File[]>([]);
  const [choice, setChoice] = useState<AccessChoice>(PUBLIC_ACCESS);
  const accessStep = useRef<HTMLDivElement>(null);
  const stage = (files: File[]) => {
    if (files.length === 0) return;
    setStaged((s) => [...s, ...files]);
  };
  const jobs = useQuery({
    queryKey: ["ingestion-jobs"],
    queryFn: () => client.listJobs({ page: { pageSize: 50 } }),
    refetchInterval: (query) => (query.state.data?.jobs.some(active) ? ACTIVE_REFRESH_MS : false),
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

  // The access step is new content: focus moves into it.
  const hasStaged = staged.length > 0;
  useEffect(() => {
    if (hasStaged) accessStep.current?.querySelector<HTMLElement>("input")?.focus();
  }, [hasStaged]);

  const confirmAccess = () => {
    add(staged, choice.team ? choice.teamIds : []);
    setStaged([]);
    setChoice(PUBLIC_ACCESS);
    setFocusAfter("choose");
  };
  const cancelAccess = () => {
    setStaged([]);
    setChoice(PUBLIC_ACCESS);
    setFocusAfter("choose");
  };

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
        eyebrow="knowcelium / upload"
        title="Upload"
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
          stage(Array.from(e.dataTransfer.files));
        }}
        className={`mb-6 flex flex-col items-center gap-2 rounded-card border-2 border-dashed p-10 text-sm text-fg-muted transition-colors ${dragging ? "border-accent bg-accent-subtle" : "border-accent/40 bg-accent-subtle/40"}`}
      >
        <span className="inline-flex size-12 items-center justify-center rounded-card bg-accent-subtle text-accent">
          <UploadIcon className="size-6" aria-hidden="true" />
        </span>
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
            stage(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {staged.length > 0 && (
        <form
          className="mb-6 rounded-card border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (isValidAccess(choice)) confirmAccess();
          }}
        >
          <p className="mb-3 text-sm">
            {staged.length === 1 ? (
              <span className="font-medium">{staged[0]?.name}</span>
            ) : (
              <span className="font-medium">{staged.length} files</span>
            )}{" "}
            {staged.length === 1 ? "is" : "are"} ready to upload.
          </p>
          <div ref={accessStep}>
            <AccessPicker
              legend="Who can read this?"
              teams={teams.map((t) => ({ id: t.id, name: t.name }))}
              value={choice}
              onChange={setChoice}
            />
          </div>
          {choice.team && choice.teamIds.length === 0 && (
            <p className="mt-2 text-xs text-fg-muted">Choose at least one team.</p>
          )}
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={!isValidAccess(choice)}>
              Upload
            </Button>
            <Button type="button" variant="secondary" onClick={cancelAccess}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {regions}
      <h2 className="mb-2 font-medium">Uploads</h2>
      <ErrorMessage error={jobs.error} />
      <Card>
        {jobs.isPending && uploads.length === 0 ? (
          <DelayedLoading>
            <SkeletonRows label="Loading uploads" />
          </DelayedLoading>
        ) : empty ? (
          <EmptyState icon={FileUp}>No uploads yet. Drop files above to add documents.</EmptyState>
        ) : (
          <ul ref={list} className="divide-y divide-dotted divide-border text-sm">
            {uploads.map((u) => (
              <UploadItem
                key={u.key}
                upload={u}
                access={
                  u.teamIds.length === 0
                    ? "Public"
                    : `Team: ${u.teamIds
                        .map((id) => teams.find((t) => t.id === id)?.name)
                        .filter(Boolean)
                        .join(", ")}`
                }
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
                  {job.status === JobStatus.PROCESSING && (
                    <>
                      <span className="text-fg-muted">{stageLabel[job.stage]}</span>
                      <ProgressBar percent={job.progress} label={`Processing ${job.filename}`} />
                    </>
                  )}
                  {job.status === JobStatus.DONE && (
                    <span className="text-fg-muted">
                      {job.chunkCount} {job.chunkCount === 1 ? "chunk" : "chunks"}
                    </span>
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
  access,
  onRetry,
  onRemove,
}: {
  upload: UploadRow;
  /** Who can read the document: "Public" or the names of its teams. */
  access: string;
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
      <span className="text-fg-muted">{access}</span>
      {status === "waiting" && <span className="text-fg-muted">Waiting</span>}
      {status === "uploading" && <ProgressBar percent={percent} label={`Uploading ${file.name}`} />}
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
      <IconButton label={removeLabel} data-focus={`upload-${key}`} onClick={onRemove}>
        <X className="size-4" />
      </IconButton>
    </li>
  );
}
