import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { IamService, TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  IngestionService,
  JobStage,
  JobStatus,
} from "@knowcel/ingestion-api/knowcel/ingestion/v1/ingestion_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("shows the stage and progress of a job being processed", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, {
        listJobs: () => ({
          jobs: [
            {
              id: "j1",
              filename: "manual.pdf",
              status: JobStatus.PROCESSING,
              stage: JobStage.EMBEDDING,
              progress: 42,
            },
            { id: "j2", filename: "report.pdf", status: JobStatus.DONE, progress: 100 },
          ],
        }),
      }),
    );
    renderModule(ingestion, transport);
    const row = within((await screen.findByText("manual.pdf")).closest("li") as HTMLElement);
    const bar = row.getByRole("progressbar", { name: "Processing manual.pdf" });
    expect(bar.getAttribute("value")).toBe("42");
    expect(row.getByText("42 %")).toBeTruthy();
    expect(row.getByText("Indexing")).toBeTruthy();
    expect(row.getByText("Processing")).toBeTruthy();
    // Finished jobs show their result, not a bar.
    const done = within(screen.getByText("report.pdf").closest("li") as HTMLElement);
    expect(done.queryByRole("progressbar")).toBeNull();
  });

  it("refreshes the list while a job is being processed", async () => {
    let calls = 0;
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, {
        listJobs: () => {
          calls += 1;
          return {
            jobs: [
              {
                id: "j1",
                filename: "manual.pdf",
                status: JobStatus.PROCESSING,
                stage: JobStage.EMBEDDING,
                progress: calls === 1 ? 20 : 60,
              },
            ],
          };
        },
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderModule(ingestion, transport);
      expect(await screen.findByText("20 %")).toBeTruthy();
      await vi.advanceTimersByTimeAsync(3000);
      expect(await screen.findByText("60 %")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a single chunk in the singular", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, {
        listJobs: () => ({
          jobs: [
            { id: "j1", filename: "note.txt", status: JobStatus.DONE, chunkCount: 1 },
            { id: "j2", filename: "memo.txt", status: JobStatus.DONE, chunkCount: 2 },
          ],
        }),
      }),
    );
    renderModule(ingestion, transport);
    const one = within((await screen.findByText("note.txt")).closest("li") as HTMLElement);
    expect(one.getByText("1 chunk")).toBeTruthy();
    const two = within(screen.getByText("memo.txt").closest("li") as HTMLElement);
    expect(two.getByText("2 chunks")).toBeTruthy();
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

  describe("sharing", () => {
    const transport = (iam: boolean) =>
      createRouterTransport(({ service }) => {
        service(IngestionService, { listJobs: () => ({ jobs: [] }) });
        if (iam) {
          service(IamService, {
            listMyTeams: () => ({
              teams: [
                { id: "t1", name: "Platform", myRole: TeamRole.ADMIN, members: [] },
                { id: "t2", name: "Support", myRole: TeamRole.MEMBER, members: [] },
              ],
            }),
          });
        }
      });

    const choose = (...names: string[]) => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      fireEvent.change(input as HTMLInputElement, {
        target: { files: names.map((n) => new File(["x"], n, { type: "text/markdown" })) },
      });
    };

    it("asks for the access before uploading, public preselected", async () => {
      const createUpload = vi.fn();
      const t = createRouterTransport(({ service }) => {
        service(IngestionService, { listJobs: () => ({ jobs: [] }), createUpload });
        service(IamService, { listMyTeams: () => ({ teams: [] }) });
      });
      renderModule(ingestion, t);
      await screen.findByText("No uploads yet. Drop files above to add documents.");
      choose("a.md");
      const group = await screen.findByRole("group", { name: "Who can read this?" });
      expect(
        (within(group).getByRole("radio", { name: /Public/ }) as HTMLInputElement).checked,
      ).toBe(true);
      expect(screen.getByText("is ready to upload.")).toBeTruthy();
      expect(createUpload).not.toHaveBeenCalled();
    });

    it("needs a team for team access", async () => {
      renderModule(ingestion, transport(true));
      await screen.findByText("No uploads yet. Drop files above to add documents.");
      choose("a.md", "b.md");
      const group = await screen.findByRole("group", { name: "Who can read this?" });
      fireEvent.click(within(group).getByRole("radio", { name: /Team/ }));
      const upload = screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement;
      expect(upload.disabled).toBe(true);
      fireEvent.click(within(group).getByRole("checkbox", { name: "Support" }));
      expect(upload.disabled).toBe(false);
    });

    it("drops the staged files on cancel", async () => {
      renderModule(ingestion, transport(true));
      await screen.findByText("No uploads yet. Drop files above to add documents.");
      choose("a.md");
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("group", { name: "Who can read this?" })).toBeNull();
    });

    it("offers only public without IAM, and no error", async () => {
      renderModule(ingestion, transport(false));
      await screen.findByText("No uploads yet. Drop files above to add documents.");
      choose("a.md");
      const group = await screen.findByRole("group", { name: "Who can read this?" });
      expect(
        (within(group).getByRole("radio", { name: /Team/ }) as HTMLInputElement).disabled,
      ).toBe(true);
      // The page's own urgent live region is always there, and empty.
      expect(screen.queryAllByRole("alert").map((a) => a.textContent)).toEqual([""]);
    });
  });
});
