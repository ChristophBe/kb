import { type Job, JobStage, JobStatus } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";

/** A job that is waiting for or in processing. */
export const active = (job: Job) =>
  job.status === JobStatus.QUEUED || job.status === JobStatus.PROCESSING;

/** What the user sees for each processing stage. */
export const stageLabel: Record<JobStage, string> = {
  [JobStage.UNSPECIFIED]: "Starting",
  [JobStage.EXTRACTING]: "Reading",
  [JobStage.CHUNKING]: "Splitting",
  [JobStage.EMBEDDING]: "Indexing",
  [JobStage.STORING]: "Saving",
};

/** A progress bar with its percentage; label names it for screen readers. */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <progress max={100} value={percent} aria-label={label} className="h-1.5 w-40 accent-fg" />
      <span className="w-10 text-right font-mono text-fg-muted tabular-nums">{percent} %</span>
    </span>
  );
}
