import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  IngestionService,
  JobStage,
  JobStatus,
} from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { renderWidget } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActiveJobs } from "./ActiveJobs.tsx";

describe("ActiveJobs", () => {
  it("shows the running jobs with their stage and progress", async () => {
    const { container } = renderWidget(
      ActiveJobs,
      createRouterTransport(({ service }) =>
        service(IngestionService, {
          listJobs: () => ({
            jobs: [
              {
                id: "j1",
                filename: "report.pdf",
                status: JobStatus.PROCESSING,
                stage: JobStage.EMBEDDING,
                progress: 60,
              },
              { id: "j2", filename: "notes.md", status: JobStatus.QUEUED },
              { id: "j3", filename: "done.txt", status: JobStatus.DONE },
              { id: "j4", filename: "broken.pdf", status: JobStatus.FAILED },
            ],
          }),
        }),
      ),
    );
    const bar = await screen.findByRole("progressbar", { name: "Processing report.pdf" });
    expect(bar.getAttribute("value")).toBe("60");
    expect(screen.getByText("Indexing")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
    // Finished jobs are on the ingestion page, not here.
    expect(screen.queryByText("done.txt")).toBeNull();
    expect(screen.queryByText("broken.pdf")).toBeNull();
    expect(screen.getByRole("link", { name: "Upload documents" }).getAttribute("href")).toBe(
      "/m/ingestion",
    );
    await expectNoAxeViolations(container);
  });

  it("says so when nothing is being processed", async () => {
    renderWidget(
      ActiveJobs,
      createRouterTransport(({ service }) =>
        service(IngestionService, {
          listJobs: () => ({ jobs: [{ id: "j1", filename: "a.md", status: JobStatus.DONE }] }),
        }),
      ),
    );
    expect(await screen.findByText(/Nothing is being processed/)).toBeTruthy();
  });

  it("stays calm while the service is down", async () => {
    renderWidget(
      ActiveJobs,
      createRouterTransport(({ service }) =>
        service(IngestionService, {
          listJobs: () => {
            throw new ConnectError("no healthy upstream", Code.Unavailable);
          },
        }),
      ),
    );
    expect(await screen.findByText("Uploads can't be checked right now.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
