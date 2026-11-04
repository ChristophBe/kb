import { create } from "@bufbuild/protobuf";
import { type Job, JobSchema, JobStatus } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { Code, ConnectError } from "@kb/module-sdk";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type Put, UploadError } from "./put.ts";
import {
  PARALLEL_UPLOADS,
  describe as reason,
  type UploadClient,
  useUploads,
} from "./useUploads.ts";

const file = (name: string, type = "text/plain") => new File(["content"], name, { type });

/** A fake IngestionService whose jobs finish as `outcome` when watched. */
function fakeClient(outcome = JobStatus.DONE) {
  let n = 0;
  const job = (id: string, status: JobStatus, error = "") =>
    create(JobSchema, { id, filename: id, status, error });
  const client = {
    createUpload: vi.fn(async () => {
      n++;
      return { job: job(`job${n}`, JobStatus.PENDING_UPLOAD), uploadUrl: `http://s3/url${n}` };
    }),
    completeUpload: vi.fn(async ({ jobId }: { jobId: string }) => ({
      job: job(jobId, JobStatus.QUEUED),
    })),
    watchJob: vi.fn(async function* ({ id }: { id: string }) {
      yield { job: job(id, outcome, outcome === JobStatus.FAILED ? "no text" : "") };
    }),
  } satisfies UploadClient;
  return client;
}

/** A put that waits until the test settles it. */
function controlledPut() {
  const calls: { url: string; progress: (f: number) => void; settle: (err?: Error) => void }[] = [];
  const put: Put = (url, _file, onProgress, signal) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
      calls.push({ url, progress: onProgress, settle: (err) => (err ? reject(err) : resolve()) });
    });
  return { put, calls };
}

function setup(client = fakeClient(), put: Put = async () => {}, now = () => 0) {
  const events = { onJob: vi.fn<(job: Job) => void>(), announce: vi.fn(), notify: vi.fn() };
  const hook = renderHook(() => useUploads(client, put, events, now));
  return { hook, events, client };
}

describe("useUploads", () => {
  it("uploads, completes and hands over to the job", async () => {
    const { hook, events, client } = setup();
    act(() => hook.result.current.add([file("a.md")]));

    await waitFor(() => expect(hook.result.current.uploads).toEqual([]));
    expect(client.completeUpload).toHaveBeenCalledWith({ jobId: "job1" });
    expect(events.announce).toHaveBeenCalledWith("Uploading 1 file");
    expect(events.announce).toHaveBeenCalledWith("a.md uploaded, processing");
    await waitFor(() => expect(events.announce).toHaveBeenCalledWith("a.md is ready", false));
    expect(events.onJob.mock.calls.map(([j]) => j.status)).toEqual([
      JobStatus.QUEUED,
      JobStatus.DONE,
    ]);
  });

  it("reports progress per file", async () => {
    const { put, calls } = controlledPut();
    const { hook } = setup(fakeClient(), put);
    act(() => hook.result.current.add([file("a.md"), file("b.md")]));
    await waitFor(() => expect(calls).toHaveLength(2));

    act(() => calls[0]?.progress(0.5));
    const byName = () => new Map(hook.result.current.uploads.map((u) => [u.file.name, u]));
    expect(byName().get("a.md")?.progress).toBe(0.5);
    expect(byName().get("b.md")?.progress).toBe(0);
  });

  it("rejects unsupported files before any request", () => {
    const { hook, events, client } = setup();
    act(() => hook.result.current.add([file("slides.pptx", "")]));
    expect(hook.result.current.uploads[0]?.status).toBe("rejected");
    expect(client.createUpload).not.toHaveBeenCalled();
    expect(events.announce).toHaveBeenCalledWith(
      "slides.pptx isn't supported. Use PDF, Markdown or plain text.",
    );
  });

  it(`runs at most ${PARALLEL_UPLOADS} uploads at once`, async () => {
    const { put, calls } = controlledPut();
    const { hook } = setup(fakeClient(), put);
    act(() => hook.result.current.add(["1", "2", "3", "4", "5"].map((n) => file(`${n}.md`))));
    await waitFor(() => expect(calls).toHaveLength(PARALLEL_UPLOADS));
    expect(hook.result.current.uploads.filter((u) => u.status === "waiting")).toHaveLength(2);

    await act(async () => calls[0]?.settle());
    await waitFor(() => expect(calls).toHaveLength(PARALLEL_UPLOADS + 1));
  });

  it("fails one file without affecting the others, and retries it on the same URL", async () => {
    const { put, calls } = controlledPut();
    const { hook, events, client } = setup(fakeClient(), put);
    act(() => hook.result.current.add([file("a.md"), file("b.md")]));
    await waitFor(() => expect(calls).toHaveLength(2));

    await act(async () => calls[0]?.settle(new UploadError("connection lost")));
    const failed = hook.result.current.uploads.find((u) => u.status === "failed");
    expect(failed?.error).toBe("connection lost");
    expect(hook.result.current.uploads.find((u) => u !== failed)?.status).toBe("uploading");
    expect(events.announce).toHaveBeenCalledWith(`Upload of ${failed?.file.name} failed`, true);

    act(() => hook.result.current.retry(failed?.key ?? 0));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]?.url).toBe(calls[0]?.url);
    expect(client.createUpload).toHaveBeenCalledTimes(2);
  });

  it("asks for a new URL once the old one has expired", async () => {
    let time = 0;
    const { put, calls } = controlledPut();
    const { hook, client } = setup(fakeClient(), put, () => time);
    act(() => hook.result.current.add([file("a.md")]));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.settle(new UploadError("connection lost")));

    time = 20 * 60 * 1000;
    act(() => hook.result.current.retry(hook.result.current.uploads[0]?.key ?? 0));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(client.createUpload).toHaveBeenCalledTimes(2);
    expect(calls[1]?.url).toBe("http://s3/url2");
    expect(hook.result.current.abandonedJobs.has("job1")).toBe(true);
  });

  it("asks for a new URL when the storage server says it expired", async () => {
    const { put, calls } = controlledPut();
    const { hook, client } = setup(fakeClient(), put);
    act(() => hook.result.current.add([file("a.md")]));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.settle(new UploadError("the upload link expired", true)));

    act(() => hook.result.current.retry(hook.result.current.uploads[0]?.key ?? 0));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(client.createUpload).toHaveBeenCalledTimes(2);
  });

  it("cancels a running upload and hides its pending job", async () => {
    const { put, calls } = controlledPut();
    const { hook, client } = setup(fakeClient(), put);
    act(() => hook.result.current.add([file("a.md")]));
    await waitFor(() => expect(calls).toHaveLength(1));

    await act(async () => hook.result.current.remove(hook.result.current.uploads[0]?.key ?? 0));
    expect(hook.result.current.uploads).toEqual([]);
    expect(hook.result.current.abandonedJobs.has("job1")).toBe(true);
    expect(client.completeUpload).not.toHaveBeenCalled();
  });

  it("announces failed processing as urgent", async () => {
    const { hook, events } = setup(fakeClient(JobStatus.FAILED));
    act(() => hook.result.current.add([file("scan.md")]));
    await waitFor(() =>
      expect(events.announce).toHaveBeenCalledWith("Processing scan.md failed: no text", true),
    );
  });

  it("uses toasts instead once the page is gone", async () => {
    const { put, calls } = controlledPut();
    const { hook, events } = setup(fakeClient(), put);
    act(() => hook.result.current.add([file("a.md")]));
    await waitFor(() => expect(calls).toHaveLength(1));
    hook.unmount();
    await act(async () => calls[0]?.settle());
    await waitFor(() => expect(events.notify).toHaveBeenCalledWith("a.md added", false));
  });
});

describe("describe", () => {
  it("gives a readable reason for each kind of failure", () => {
    expect(reason(new UploadError("connection lost"))).toBe("connection lost");
    expect(reason(new ConnectError("Failed to fetch", Code.Unknown))).toBe(
      "the server couldn't be reached",
    );
    expect(reason(new ConnectError("down", Code.Unavailable))).toBe(
      "the server couldn't be reached",
    );
    expect(
      reason(new ConnectError("the file has not been uploaded", Code.FailedPrecondition)),
    ).toBe("the file has not been uploaded");
  });
});
