import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { IngestionService, JobStatus } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { badRequestDetail } from "@kb/ui/testing/errors";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ingestion from "./index.tsx";
import { putWithProgress } from "./put.ts";

vi.mock("./put.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./put.ts")>()),
  putWithProgress: vi.fn(),
}));
const put = vi.mocked(putWithProgress);

function choose(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ReplaceUpload", () => {
  beforeEach(() => {
    put.mockReset();
  });

  it("uploads the new version and returns to the document", async () => {
    const replaceUpload = vi.fn(() => ({
      job: {
        id: "j1",
        documentId: "d1",
        contentType: "text/markdown",
        status: JobStatus.PENDING_UPLOAD,
      },
      uploadUrl: "http://s3/v2",
    }));
    const completeUpload = vi.fn(() => ({ job: { id: "j1", status: JobStatus.QUEUED } }));
    put.mockResolvedValue();
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, { replaceUpload, completeUpload }),
    );
    const { container, router } = renderModule(ingestion, transport, "/replace/d1");
    expect(screen.getByRole("heading", { name: "Upload new version" })).toBeTruthy();
    await act(async () => choose(container, new File(["# v2"], "notes.md")));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/m/document/d1"));
    expect(replaceUpload).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "d1", filename: "notes.md", sizeBytes: 4n }),
      expect.anything(),
    );
    // Sent with the type the server named, which the URL is signed for.
    expect(put.mock.calls[0]?.slice(0, 3)).toEqual([
      "http://s3/v2",
      expect.any(File),
      "text/markdown",
    ]);
    expect(completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1" }),
      expect.anything(),
    );
  });

  it("shows why the file wasn't taken and lets the user choose another", async () => {
    const err = new ConnectError("too large", Code.InvalidArgument);
    err.details.push(
      badRequestDetail([
        { field: "size_bytes", description: "The file is larger than the limit of 50 MiB" },
      ]),
    );
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, {
        replaceUpload: () => {
          throw err;
        },
      }),
    );
    const { container } = renderModule(ingestion, transport, "/replace/d1");
    await act(async () => choose(container, new File(["x"], "big.pdf")));
    expect(
      await screen.findByText(
        "big.pdf wasn't uploaded: The file is larger than the limit of 50 MiB",
      ),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Choose file" }));
    expect(put).not.toHaveBeenCalled();
  });

  it("explains a document that is still being processed", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, {
        replaceUpload: () => {
          throw new ConnectError(
            "the document is still being uploaded or processed",
            Code.FailedPrecondition,
          );
        },
      }),
    );
    const { container } = renderModule(ingestion, transport, "/replace/d1");
    await act(async () => choose(container, new File(["x"], "a.md")));
    expect(
      await screen.findByText(
        "a.md wasn't uploaded: the document is still being uploaded or processed",
      ),
    ).toBeTruthy();
  });

  it("refuses a file it can't read before uploading", async () => {
    const replaceUpload = vi.fn();
    const transport = createRouterTransport(({ service }) =>
      service(IngestionService, { replaceUpload }),
    );
    const { container } = renderModule(ingestion, transport, "/replace/d1");
    await act(async () => choose(container, new File(["x"], "photo.png", { type: "image/png" })));
    expect(screen.getByText(/photo\.png isn't supported/)).toBeTruthy();
    expect(replaceUpload).not.toHaveBeenCalled();
  });
});
