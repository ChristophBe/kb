import type { Job } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { JobStatus } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { Code, ConnectError } from "@kb/module-sdk";
import { fieldViolations } from "@kb/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { isSupported, SUPPORTED_FORMATS, sha256 } from "./files.ts";
import { type Put, UploadError } from "./put.ts";

/** Uploads at the same time; the rest wait. */
export const PARALLEL_UPLOADS = 3;
/** Presigned URLs live 15 minutes (document module); a little margin avoids a 403. */
const URL_LIFETIME_MS = 14 * 60 * 1000;

/** The RPCs of IngestionService that uploading needs. */
export interface UploadClient {
  createUpload(req: {
    filename: string;
    contentType: string;
    sizeBytes: bigint;
    sha256: string;
  }): Promise<{ job?: Job; uploadUrl: string }>;
  completeUpload(req: { jobId: string }): Promise<{ job?: Job }>;
  watchJob(req: { id: string }): AsyncIterable<{ job?: Job }>;
  reprocessJob(req: { id: string }): Promise<{ job?: Job }>;
}

export type UploadStatus = "waiting" | "uploading" | "failed" | "rejected";

/** A file on its way to the bucket. Once the upload completes, its job takes over. */
export interface Upload {
  key: number;
  file: File;
  status: UploadStatus;
  /** 0 to 1 while uploading. */
  progress: number;
  error?: string;
}

/** Where a file goes: the job created for it and its presigned URL, signed for contentType. */
interface Target {
  jobId: string;
  url: string;
  contentType: string;
  issuedAt: number;
}

export interface UploadEvents {
  /** A job was created or changed. */
  onJob(job: Job): void;
  /** Something worth telling screen-reader users; `urgent` for failures. */
  announce(message: string, urgent?: boolean): void;
  /** A finished job, reported after the page was left. */
  notify(message: string, failed: boolean): void;
  /** A request that failed outside an upload row, e.g. reprocessing a job. */
  error(message: string): void;
}

let nextKey = 1;

/** A reason for a failed upload that a user can act on. */
export function describe(err: unknown): string {
  if (err instanceof UploadError) return err.message;
  if (err instanceof ConnectError) {
    // A request that never reached the server surfaces as Unknown ("Failed to fetch").
    if (err.code === Code.Unavailable || err.code === Code.Unknown) {
      return "the server couldn't be reached";
    }
    return err.rawMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

export function useUploads(client: UploadClient, put: Put, events: UploadEvents, now = Date.now) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  // Jobs replaced by a new upload after their URL expired; they would show as stuck.
  const [abandonedJobs, setAbandonedJobs] = useState<ReadonlySet<string>>(new Set());
  // Jobs whose ReprocessJob request is in flight.
  const [reprocessing, setReprocessing] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const targets = useRef(new Map<number, Target>());
  const controllers = useRef(new Map<number, AbortController>());
  const started = useRef(new Set<number>());
  const mounted = useRef(true);
  const latest = useRef({ client, put, events, now });
  latest.current = { client, put, events, now };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = useCallback((key: number, change: Partial<Upload>) => {
    setUploads((us) => us.map((u) => (u.key === key ? { ...u, ...change } : u)));
  }, []);

  const finish = useCallback(async (jobId: string, filename: string) => {
    const { client, events } = latest.current;
    let status: JobStatus | undefined;
    let error = "";
    for await (const update of client.watchJob({ id: jobId })) {
      if (!update.job) continue;
      events.onJob(update.job);
      status = update.job.status;
      error = update.job.error;
    }
    const failed = status === JobStatus.FAILED;
    if (status !== JobStatus.DONE && !failed) return;
    if (mounted.current) {
      events.announce(
        failed ? `Processing ${filename} failed: ${error}` : `${filename} is ready`,
        failed,
      );
    } else {
      events.notify(failed ? `Couldn't process ${filename}` : `${filename} added`, failed);
    }
  }, []);

  const run = useCallback(
    async (upload: Upload) => {
      const { client, put, events, now } = latest.current;
      const { key, file } = upload;
      const controller = new AbortController();
      controllers.current.set(key, controller);
      patch(key, { status: "uploading", progress: 0, error: undefined });
      try {
        let target = targets.current.get(key);
        if (!target || now() - target.issuedAt > URL_LIFETIME_MS) {
          if (target) {
            const replaced = target.jobId;
            setAbandonedJobs((s) => new Set([...s, replaced]));
          }
          const created = await client.createUpload({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: BigInt(file.size),
            sha256: await sha256(file),
          });
          target = {
            jobId: created.job?.id ?? "",
            url: created.uploadUrl,
            // The server may name a better type than the browser's (e.g. for .md).
            contentType: created.job?.contentType || file.type || "application/octet-stream",
            issuedAt: now(),
          };
          targets.current.set(key, target);
        }
        controller.signal.throwIfAborted();
        await put(
          target.url,
          file,
          target.contentType,
          (progress) => patch(key, { progress }),
          controller.signal,
        );
        controller.signal.throwIfAborted();
        const completed = await client.completeUpload({ jobId: target.jobId });
        if (completed.job) events.onJob(completed.job);
        targets.current.delete(key);
        setUploads((us) => us.filter((u) => u.key !== key));
        events.announce(`${file.name} uploaded, processing`);
        void finish(target.jobId, file.name).catch(() => {});
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof UploadError && err.expired) targets.current.delete(key);
        // The server rejected the file itself (e.g. it is empty): retrying won't help.
        const violations = fieldViolations(err);
        if (violations.length > 0) {
          const reason = violations.map((v) => v.description).join(". ");
          patch(key, { status: "rejected", error: reason });
          events.announce(`${file.name} wasn't uploaded: ${reason}`, true);
          return;
        }
        patch(key, { status: "failed", error: describe(err) });
        events.announce(`Upload of ${file.name} failed`, true);
      } finally {
        controllers.current.delete(key);
        started.current.delete(key);
      }
    },
    [finish, patch],
  );

  // Starts waiting uploads while fewer than PARALLEL_UPLOADS are running.
  useEffect(() => {
    let free = PARALLEL_UPLOADS - uploads.filter((u) => u.status === "uploading").length;
    for (const upload of uploads) {
      if (free <= 0) break;
      if (upload.status !== "waiting" || started.current.has(upload.key)) continue;
      started.current.add(upload.key);
      free--;
      void run(upload);
    }
  }, [uploads, run]);

  const add = useCallback((files: Iterable<File>) => {
    const added: Upload[] = [...files].map((file) => ({
      key: nextKey++,
      file,
      status: isSupported(file) ? "waiting" : "rejected",
      progress: 0,
      error: isSupported(file) ? undefined : `Not supported (${SUPPORTED_FORMATS})`,
    }));
    if (added.length === 0) return;
    setUploads((us) => [...added, ...us]);
    const { announce } = latest.current.events;
    const accepted = added.filter((u) => u.status === "waiting").length;
    if (accepted > 0) announce(`Uploading ${accepted} ${accepted === 1 ? "file" : "files"}`);
    for (const u of added) {
      if (u.status === "rejected") {
        announce(`${u.file.name} isn't supported. Use ${SUPPORTED_FORMATS}.`);
      }
    }
  }, []);

  const retry = useCallback(
    (key: number) => patch(key, { status: "waiting", progress: 0, error: undefined }),
    [patch],
  );

  /** Cancels a running upload, or dismisses a failed or rejected one. */
  const remove = useCallback((key: number) => {
    controllers.current.get(key)?.abort();
    const target = targets.current.get(key);
    if (target) setAbandonedJobs((s) => new Set([...s, target.jobId]));
    targets.current.delete(key);
    setUploads((us) => us.filter((u) => u.key !== key));
  }, []);

  /**
   * Queues a failed or done job again; the worker replaces the document's chunks.
   * Resolves to whether the job was queued. A second call while one is in flight is ignored.
   */
  const reprocess = useCallback(
    async (job: Job) => {
      const { client, events } = latest.current;
      if (inFlight.current.has(job.id)) return false;
      inFlight.current.add(job.id);
      setReprocessing(new Set(inFlight.current));
      try {
        const queued = await client.reprocessJob({ id: job.id });
        if (queued.job) events.onJob(queued.job);
        events.announce(`${job.filename} queued for processing`);
        void finish(job.id, job.filename).catch(() => {});
        return true;
      } catch (err) {
        events.error(`Couldn't reprocess ${job.filename}: ${describe(err)}`);
        return false;
      } finally {
        inFlight.current.delete(job.id);
        if (mounted.current) setReprocessing(new Set(inFlight.current));
      }
    },
    [finish],
  );

  return { uploads, abandonedJobs, reprocessing, add, retry, remove, reprocess };
}
