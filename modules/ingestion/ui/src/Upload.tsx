import {
  IngestionService,
  type Job,
  JobStatus,
} from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { toast, useClient, useQuery, useQueryClient } from "@kb/module-sdk";
import { Badge, Card, EmptyState, ErrorMessage, formatTime, PageHeader, type Tone } from "@kb/ui";
import { Upload as UploadIcon } from "lucide-react";
import { useState } from "react";

const statusLabel: Record<JobStatus, [string, Tone]> = {
  [JobStatus.UNSPECIFIED]: ["Unknown", "neutral"],
  [JobStatus.PENDING_UPLOAD]: ["Uploading", "neutral"],
  [JobStatus.QUEUED]: ["Queued", "info"],
  [JobStatus.PROCESSING]: ["Processing", "warning"],
  [JobStatus.DONE]: ["Done", "success"],
  [JobStatus.FAILED]: ["Failed", "danger"],
};

export function Upload() {
  const client = useClient(IngestionService);
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);
  const jobs = useQuery({
    queryKey: ["ingestion-jobs"],
    queryFn: () => client.listJobs({ page: { pageSize: 50 } }),
  });

  const updateJob = (job: Job) =>
    queryClient.setQueryData(["ingestion-jobs"], (old: typeof jobs.data) =>
      old ? { ...old, jobs: [job, ...old.jobs.filter((j) => j.id !== job.id)] } : old,
    );

  const ingest = async (file: File) => {
    const created = await client.createUpload({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: BigInt(file.size),
    });
    if (created.job) updateJob(created.job);
    const put = await fetch(created.uploadUrl, { method: "PUT", body: file });
    if (!put.ok) throw new Error(`upload of ${file.name} failed: ${put.status}`);
    const completed = await client.completeUpload({ jobId: created.job?.id ?? "" });
    if (completed.job) updateJob(completed.job);
    let status = completed.job?.status;
    for await (const update of client.watchJob({ id: completed.job?.id ?? "" })) {
      if (update.job) updateJob(update.job);
      status = update.job?.status ?? status;
    }
    if (status === JobStatus.DONE) toast.success(`${file.name} added`);
    if (status === JobStatus.FAILED) toast.error(`Couldn't process ${file.name}`);
  };

  const onFiles = (files: FileList | null) => {
    setError(null);
    for (const file of Array.from(files ?? [])) ingest(file).catch(setError);
  };

  return (
    <div>
      <PageHeader
        eyebrow="kb / ingestion"
        title="Ingestion"
        description="Upload documents to add them to the knowledge base."
      />
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: drag and drop is a pointer shortcut; keyboard users reach the file input inside the label. */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`mb-6 flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed p-10 text-sm text-fg-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${dragging ? "border-border-strong bg-surface-muted" : "border-border-strong bg-surface"}`}
      >
        <UploadIcon className="size-6" />
        Drop files here or click to choose (PDF, Markdown, text)
        <input type="file" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
      </label>
      <ErrorMessage error={error ?? jobs.error} />
      <Card>
        {jobs.data?.jobs.length ? (
          <ul className="divide-y divide-dotted divide-border text-sm">
            {jobs.data.jobs.map((job) => {
              const [label, tone] = statusLabel[job.status];
              return (
                <li key={job.id} className="flex items-center gap-4 px-4 py-2">
                  <span className="flex-1 truncate font-medium">{job.filename}</span>
                  {job.status === JobStatus.DONE && (
                    <span className="text-fg-muted">{job.chunkCount} chunks</span>
                  )}
                  {job.error && <span className="truncate text-danger">{job.error}</span>}
                  <span className="font-mono text-fg-muted tabular-nums">
                    {formatTime(job.createTime)}
                  </span>
                  <Badge tone={tone}>{label}</Badge>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>No uploads yet.</EmptyState>
        )}
      </Card>
    </div>
  );
}
