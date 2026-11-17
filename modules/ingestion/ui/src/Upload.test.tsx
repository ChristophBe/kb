import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Access, DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { IamService, TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  IngestionService,
  JobStage,
  JobStatus,
} from "@knowcel/ingestion-api/knowcel/ingestion/v1/ingestion_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import ingestion from "./index.tsx";
import { putWithProgress } from "./put.ts";

vi.mock("./put.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./put.ts")>()),
  putWithProgress: vi.fn(),
}));
const put = vi.mocked(putWithProgress);

// Uploading itself is covered by useUploads.test.ts; these render the page.
describe("Upload", () => {
  beforeAll(polyfillDialog);

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
    expect(done.getByText("12 passages")).toBeTruthy();
    expect(done.getByText("Ready")).toBeTruthy();
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

  it("counts a single passage in the singular", async () => {
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
    expect(one.getByText("1 passage")).toBeTruthy();
    const two = within(screen.getByText("memo.txt").closest("li") as HTMLElement);
    expect(two.getByText("2 passages")).toBeTruthy();
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

  describe("finished jobs", () => {
    const jobs = [
      { id: "j1", documentId: "d1", filename: "report.pdf", status: JobStatus.DONE },
      { id: "j2", documentId: "d2", filename: "page.html", status: JobStatus.DONE },
      {
        id: "j3",
        documentId: "d3",
        filename: "scan.pdf",
        status: JobStatus.FAILED,
        error: "no text",
      },
      { id: "j4", documentId: "d4", filename: "new.pdf", status: JobStatus.PENDING_UPLOAD },
    ];
    const transport = () =>
      createRouterTransport(({ service }) => {
        service(IngestionService, { listJobs: () => ({ jobs }) });
        service(IamService, {
          listMyTeams: () => ({
            teams: [{ id: "t1", name: "Platform", myRole: TeamRole.ADMIN, members: [] }],
          }),
        });
        service(DocumentService, {
          getDocument: (req) => ({
            document:
              req.id === "d2"
                ? { id: "d2", access: Access.TEAM, teamIds: ["t1"] }
                : { id: req.id, access: Access.PUBLIC },
          }),
        });
      });

    it("link to their document and show who can read it", async () => {
      renderModule(ingestion, transport());
      const done = within((await screen.findByText("report.pdf")).closest("li") as HTMLElement);
      expect(done.getByRole("link", { name: "report.pdf" }).getAttribute("href")).toBe(
        "/m/document/d1",
      );
      expect(await done.findByText("Public")).toBeTruthy();
      const page = within(screen.getByText("page.html").closest("li") as HTMLElement);
      expect(page.getByRole("link", { name: "page.html" })).toBeTruthy();
      expect(await page.findByText("Team: Platform")).toBeTruthy();
      // A failed job still has its document; one not uploaded yet has nothing to open.
      expect(screen.getByRole("link", { name: "scan.pdf" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "new.pdf" })).toBeNull();
    });

    it("mark and focus the job of the document the user came from", async () => {
      renderModule(ingestion, transport(), "/?document=d3");
      const row = (await screen.findByText("scan.pdf")).closest("li") as HTMLElement;
      await waitFor(() => expect(row.getAttribute("aria-current")).toBe("true"));
      expect(within(row).getByRole("button", { name: "Retry processing" })).toBeTruthy();
      await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
    });

    it("say so when no recent job belongs to that document", async () => {
      renderModule(ingestion, transport(), "/?document=gone");
      expect(await screen.findByText(/No recent upload belongs to that document/)).toBeTruthy();
    });
  });

  describe("leaving the page", () => {
    const start = async () => {
      let finish = () => {};
      put.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const transport = createRouterTransport(({ service }) =>
        service(IngestionService, {
          listJobs: () => ({ jobs: [] }),
          createUpload: () => ({
            job: { id: "j1", filename: "a.md" },
            uploadUrl: "http://upload",
          }),
          completeUpload: () => ({ job: { id: "j1", filename: "a.md", status: JobStatus.QUEUED } }),
          watchJob: async function* () {},
        }),
      );
      const view = renderModule(ingestion, transport);
      await screen.findByText("No uploads yet. Drop files above to add documents.");
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      fireEvent.change(input as HTMLInputElement, {
        target: { files: [new File(["x"], "a.md", { type: "text/markdown" })] },
      });
      fireEvent.click(await screen.findByRole("button", { name: "Upload" }));
      await waitFor(() => expect(put).toHaveBeenCalled());
      return { ...view, finish: () => act(async () => finish()) };
    };

    it("asks before leaving during an upload, and stays on Cancel", async () => {
      const { router } = await start();
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      await act(async () => {
        void router.navigate("/replace/d1");
      });
      const dialog = within(await screen.findByRole("dialog", { name: "Leave while uploading?" }));
      fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
      expect(router.state.location.pathname).toBe("/");
    });

    it("leaves on confirmation", async () => {
      const { router } = await start();
      await act(async () => {
        void router.navigate("/replace/d1");
      });
      const dialog = within(await screen.findByRole("dialog", { name: "Leave while uploading?" }));
      fireEvent.click(dialog.getByRole("button", { name: "Leave page" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/replace/d1"));
    });

    it("never asks once the upload is finished or when nothing was started", async () => {
      const { router, finish } = await start();
      await finish();
      await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
      await act(() => router.navigate("/replace/d1"));
      expect(router.state.location.pathname).toBe("/replace/d1");
    });

    it("lets an idle page go", async () => {
      const transport = createRouterTransport(({ service }) =>
        service(IngestionService, { listJobs: () => ({ jobs: [] }) }),
      );
      const { router } = renderModule(ingestion, transport);
      await screen.findByText("No uploads yet. Drop files above to add documents.");
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
      await act(() => router.navigate("/replace/d1"));
      expect(router.state.location.pathname).toBe("/replace/d1");
    });
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
