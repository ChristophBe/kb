import { DocumentStatus } from "@kb/document-api/kb/document/v1/document_pb";
import { KbRuntimeProvider } from "@kb/module-sdk";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNK_PAGE_SIZE, ChunkList } from "./ChunkList.tsx";

const listChunks = vi.fn();

vi.mock("@kb/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kb/module-sdk")>()),
  useClient: () => ({ listChunks }),
}));

function chunk(
  index: number,
  text = `Text of chunk ${index}`,
  metadata: Record<string, string> = {},
) {
  return { documentId: "d1", index, text, metadata };
}

function page(from: number, count: number, nextPageToken = "") {
  return {
    chunks: Array.from({ length: count }, (_, i) => chunk(from + i)),
    page: { nextPageToken },
  };
}

// The runtime's query cache outlives a test, so each render gets its own document.
let documentId = "";
let renders = 0;

function renderList(
  chunkCount: number,
  status = DocumentStatus.READY,
  statusDetail = "",
  focusIndex?: number,
) {
  documentId = `d${++renders}`;
  render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <ChunkList
        documentId={documentId}
        chunkCount={chunkCount}
        status={status}
        statusDetail={statusDetail}
        focusIndex={focusIndex}
      />
    </KbRuntimeProvider>,
  );
}

describe("ChunkList", () => {
  beforeEach(() => {
    listChunks.mockReset();
  });

  it("shows each chunk with its position, text and metadata", async () => {
    listChunks.mockResolvedValue({
      chunks: [chunk(0, "Revenue grew.", { page: "3", heading: "Results", source: "scan" })],
      page: { nextPageToken: "" },
    });
    renderList(1);
    expect(await screen.findByRole("heading", { name: "Chunk 1" })).toBeTruthy();
    expect(screen.getByText("Revenue grew.")).toBeTruthy();
    expect(screen.getByText("page 3 · Results · source: scan · 13 characters")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Showing 1–1 of 1");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(listChunks).toHaveBeenCalledWith({
      documentId,
      page: { pageSize: CHUNK_PAGE_SIZE, pageToken: "" },
    });
  });

  it("pages forward and back with the server's tokens", async () => {
    const total = CHUNK_PAGE_SIZE + 2;
    listChunks.mockImplementation(({ page: { pageToken } }) =>
      Promise.resolve(
        pageToken === "t2" ? page(CHUNK_PAGE_SIZE, 2) : page(0, CHUNK_PAGE_SIZE, "t2"),
      ),
    );
    renderList(total);
    await screen.findByRole("heading", { name: "Chunk 1" });
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });
    const firstOfPage2 = await screen.findByRole("heading", {
      name: `Chunk ${CHUNK_PAGE_SIZE + 1}`,
    });
    expect(screen.getByRole("status").textContent).toBe(
      `Showing ${CHUNK_PAGE_SIZE + 1}–${total} of ${total}`,
    );
    expect(document.activeElement).toBe(firstOfPage2);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    });
    expect(await screen.findByRole("heading", { name: "Chunk 1" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(`Showing 1–${CHUNK_PAGE_SIZE} of ${total}`);
  });

  it("opens a deep-linked chunk on its page, focused and highlighted", async () => {
    const total = CHUNK_PAGE_SIZE + 2;
    listChunks.mockImplementation(({ page: { pageToken } }) =>
      Promise.resolve(
        pageToken === "t2" ? page(CHUNK_PAGE_SIZE, 2) : page(0, CHUNK_PAGE_SIZE, "t2"),
      ),
    );
    renderList(total, DocumentStatus.READY, "", CHUNK_PAGE_SIZE + 1);
    const heading = await screen.findByRole("heading", { name: `Chunk ${CHUNK_PAGE_SIZE + 2}` });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.closest("article")?.getAttribute("data-highlighted")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(
      `Showing ${CHUNK_PAGE_SIZE + 1}–${total} of ${total}`,
    );
    // The pages walked to get there are kept, so Previous goes to page 1.
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("collapses long chunks behind Show full chunk", async () => {
    listChunks.mockResolvedValue({
      chunks: [chunk(0, "x".repeat(500))],
      page: { nextPageToken: "" },
    });
    renderList(1);
    const toggle = await screen.findByRole("button", { name: "Show full chunk" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("explains an empty list", async () => {
    listChunks.mockResolvedValue({ chunks: [], page: { nextPageToken: "" } });
    renderList(0, DocumentStatus.PROCESSING);
    expect(await screen.findByText(/no chunks yet/)).toBeTruthy();
  });

  it("shows why processing failed", async () => {
    listChunks.mockResolvedValue({ chunks: [], page: { nextPageToken: "" } });
    renderList(0, DocumentStatus.FAILED, "unsupported file");
    expect(await screen.findByText("Processing failed: unsupported file")).toBeTruthy();
  });

  it("shows errors with a retry", async () => {
    listChunks.mockRejectedValue(new Error("document not found"));
    renderList(1);
    // The runtime retries a failed query once, after a second.
    expect((await screen.findByRole("alert", {}, { timeout: 3000 })).textContent).toBe(
      "document not found",
    );
    listChunks.mockResolvedValue(page(0, 1));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByRole("heading", { name: "Chunk 1" })).toBeTruthy();
  });
});
