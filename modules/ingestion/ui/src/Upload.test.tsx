import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { IngestionService, JobStatus } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ingestion from "./index.tsx";

// Uploading itself is covered by useUploads.test.ts; these render the page.
describe("Upload", () => {
  it("lists the jobs with their status", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, {
        listJobs: () => ({
          jobs: [
            { id: "j1", filename: "report.pdf", status: JobStatus.DONE, chunkCount: 12 },
            { id: "j2", filename: "scan.pdf", status: JobStatus.FAILED, error: "no text found" },
          ],
        }),
      }),
    );
    renderModule(ingestion, transport);
    const done = within((await screen.findByText("report.pdf")).closest("li") as HTMLElement);
    expect(done.getByText("12 chunks")).toBeTruthy();
    expect(done.getByText("Done")).toBeTruthy();
    const failed = within(screen.getByText("scan.pdf").closest("li") as HTMLElement);
    expect(failed.getByText("no text found")).toBeTruthy();
    expect(failed.getByText("Failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeTruthy();
  });

  it("invites the first upload", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, { listJobs: () => ({ jobs: [] }) }),
    );
    renderModule(ingestion, transport);
    expect(
      await screen.findByText("No uploads yet. Drop files above to add documents."),
    ).toBeTruthy();
  });

  it("shows why the jobs can't be loaded", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, {
        listJobs: () => {
          throw new ConnectError("ingestion service down", Code.Unavailable);
        },
      }),
    );
    renderModule(ingestion, transport);
    const error = await screen.findByText("[unavailable] ingestion service down");
    expect(error.getAttribute("role")).toBe("alert");
  });
});
