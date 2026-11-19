import {
  IngestionService,
  type Job,
  JobStatus,
} from "@knowcel/ingestion-api/knowcel/ingestion/v1/ingestion_pb";
import { toast, useClient, useQuery, useQueryClient } from "@knowcel/module-sdk";
import {
  type AccessChoice,
  AccessPicker,
  AlertTriangle,
  Badge,
  Button,
  brandText,
  Card,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  FileUp,
  formatBytes,
  formatTime,
  IconButton,
  isValidAccess,
  PageHeader,
  PUBLIC_ACCESS,
  SkeletonRows,
  type Tone,
  Upload as UploadIcon,
  X,
} from "@knowcel/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { accessText, JobAccess } from "./access.tsx";
import { SUPPORTED_FORMATS } from "./files.ts";
import { useLeaveGuard } from "./leaveGuard.tsx";
import { active, ProgressBar, stageLabel } from "./progress.tsx";
import { putWithProgress } from "./put.ts";
import { Stepper } from "./Stepper.tsx";
import { useMyTeams } from "./useMyTeams.ts";
import { type Upload as UploadRow, useUploads } from "./useUploads.ts";

const statusLabel: Record<JobStatus, [string, Tone]> = {
  [JobStatus.UNSPECIFIED]: ["Unknown", "neutral"],
  [JobStatus.PENDING_UPLOAD]: ["Uploading", "neutral"],
  [JobStatus.QUEUED]: ["Queued", "info"],
  [JobStatus.PROCESSING]: ["Processing", "warning"],
  [JobStatus.DONE]: ["Ready", "success"],
  [JobStatus.FAILED]: ["Failed", "danger"],
};

const STEP_FILES = "Choose files";
const STEP_ACCESS = "Choose who can read them and upload";

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
    if (staged.length === 0) announce(`Step 2 of 2: ${STEP_ACCESS}`);
    setStaged((s) => [...s, ...files]);
  };
  const unstage = (index: number) => {
    const last = staged.length === 1;
    setStaged((s) => s.filter((_, i) => i !== index));
    if (last) {
      announce(`Step 1 of 2: ${STEP_FILES}`);
      setFocusAfter("choose");
    } else {
      setFocusAfter("access");
    }
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
    announce(`Upload started. Step 1 of 2: ${STEP_FILES}`);
  };
  const cancelAccess = () => {
    announce(`Step 1 of 2: ${STEP_FILES}`);
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
        : focusAfter === "access"
          ? accessStep.current?.querySelector<HTMLElement>("input")
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

  const leaveDialog = useLeaveGuard(
    uploads.some((u) => u.status === "uploading" || u.status === "waiting"),
  );

  const shownJobs = jobs.data?.jobs.filter((j) => !abandonedJobs.has(j.id)) ?? [];
  // A document page sends users here with ?document=<id> to find the job of a failed document.
  const forDocument = useSearchParams()[0].get("document");
  const highlighted = forDocument ? shownJobs.find((j) => j.documentId === forDocument) : undefined;
  const highlightedId = highlighted?.id;
  const focusedHighlight = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightedId || focusedHighlight.current === highlightedId) return;
    focusedHighlight.current = highlightedId;
    setFocusAfter(`job-${highlightedId}`);
  }, [highlightedId]);
  const empty = uploads.length === 0 && shownJobs.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow={brandText("knowcelium / upload")}
        title="Upload"
        description="Upload documents or add web pages to the knowledge base."
      />
      <Stepper
        label="Upload steps"
        steps={[
          {
            label: STEP_FILES,
            hint: hasStaged
              ? `${staged.length} ${staged.length === 1 ? "file" : "files"} chosen`
              : "Drop files below or select Choose files.",
            state: hasStaged ? "done" : "current",
          },
          {
            label: STEP_ACCESS,
            hint: hasStaged
              ? "Nothing is uploaded until you select Upload."
              : "Choose files first.",
            state: hasStaged ? "current" : "upcoming",
          },
        ]}
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
          <span>Drop to choose these files</span>
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
          <h2 className="mb-2 font-medium">{STEP_ACCESS}</h2>
          <ul
            aria-label="Chosen files"
            className="mb-3 divide-y divide-dotted divide-border text-sm"
          >
            {staged.map((file, i) => (
              <li key={`${i}-${file.name}`} className="flex items-center gap-x-4 py-1">
                <span className="min-w-0 flex-1 truncate font-medium" title={file.name}>
                  {file.name}
                </span>
                <span className="font-mono text-fg-muted tabular-nums">
                  {formatBytes(file.size)}
                </span>
                <IconButton label={`Remove ${file.name}`} onClick={() => unstage(i)}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
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
      {leaveDialog}
      <h2 className="mb-2 font-medium">Uploads</h2>
      <ErrorMessage error={jobs.error} />
      {forDocument && jobs.isSuccess && !highlighted && (
        <p className="mb-2 text-sm text-fg-muted">
          No recent upload belongs to that document. Open the document to see its status.
        </p>
      )}
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
                access={accessText(u.teamIds, teams)}
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
                <li
                  key={job.id}
                  aria-current={job.id === highlightedId ? "true" : undefined}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 ${job.id === highlightedId ? "rounded-control bg-accent-subtle" : ""}`}
                >
                  {/* Focus lands here once "Retry processing" has been replaced by the status. */}
                  <span
                    tabIndex={-1}
                    data-focus={`job-${job.id}`}
                    className="min-w-0 flex-1 truncate font-medium"
                  >
                    {job.documentId && job.status !== JobStatus.PENDING_UPLOAD ? (
                      <Link
                        to={`/m/document/${job.documentId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {job.filename}
                      </Link>
                    ) : (
                      job.filename
                    )}
                  </span>
                  {job.documentId && job.status !== JobStatus.PENDING_UPLOAD && (
                    <JobAccess documentId={job.documentId} teams={teams} />
                  )}
                  {job.status === JobStatus.PROCESSING && (
                    <>
                      <span className="text-fg-muted">{stageLabel[job.stage]}</span>
                      <ProgressBar percent={job.progress} label={`Processing ${job.filename}`} />
                    </>
                  )}
                  {job.status === JobStatus.DONE && (
                    <span className="text-fg-muted">
                      {job.chunkCount} {job.chunkCount === 1 ? "passage" : "passages"}
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
