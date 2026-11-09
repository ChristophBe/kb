import { IngestionService, JobStatus } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { Badge, DelayedLoading, SkeletonRows, Widget, WidgetMessage } from "@kb/ui";
import { Upload as UploadIcon } from "lucide-react";
import { Link } from "react-router";
import { active, ProgressBar, stageLabel } from "./progress.tsx";

/** How often the widget refreshes while jobs are running, and otherwise. */
const ACTIVE_REFRESH_MS = 3000;
const IDLE_REFRESH_MS = 15_000;

/** Home-page widget: the uploads being processed, with their stage and progress. */
export function ActiveJobs() {
  const client = useClient(IngestionService);
  const jobs = useQuery({
    queryKey: ["ingestion-jobs", "active"],
    // Jobs come newest first; running ones are among the latest.
    queryFn: async () => (await client.listJobs({ page: { pageSize: 50 } })).jobs.filter(active),
    refetchInterval: (query) => (query.state.data?.length ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS),
  });
  return (
    <Widget
      title="Processing"
      icon={UploadIcon}
      action={
        <Link to="/m/ingestion" className="font-medium text-accent hover:underline">
          Upload documents
        </Link>
      }
    >
      {jobs.isPending ? (
        <DelayedLoading>
          <SkeletonRows label="Loading uploads" rows={2} />
        </DelayedLoading>
      ) : jobs.isError ? (
        <WidgetMessage onRetry={() => jobs.refetch()}>
          Uploads can't be checked right now.
        </WidgetMessage>
      ) : jobs.data.length === 0 ? (
        <WidgetMessage>Nothing is being processed. New uploads show up here.</WidgetMessage>
      ) : (
        <ul className="divide-y divide-dotted divide-border text-sm">
          {jobs.data.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{job.filename}</span>
              {job.status === JobStatus.PROCESSING ? (
                <>
                  <span className="text-fg-muted">{stageLabel[job.stage]}</span>
                  <ProgressBar percent={job.progress} label={`Processing ${job.filename}`} />
                </>
              ) : (
                <Badge tone="info">Queued</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
