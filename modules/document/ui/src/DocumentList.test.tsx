import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  DocumentService,
  DocumentStatus,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DOCUMENT_PAGE_SIZE } from "./DocumentList.tsx";
import documents from "./index.tsx";
import { alice } from "./testing.ts";

/** A document service backed by an in-memory list. */
function documentService(
  initial: {
    id: string;
    title: string;
    status: DocumentStatus;
    ownerId?: string;
    createTime?: { seconds: bigint; nanos: number };
  }[],
) {
  let docs = initial;
  const deleteDocument = vi.fn(({ id }: { id: string }) => {
    docs = docs.filter((d) => d.id !== id);
    return {};
  });
  const transport = createRouterTransport(({ service }) =>
    service(DocumentService, {
      listDocuments: () => ({ documents: docs }),
      deleteDocument,
    }),
  );
  return { transport, deleteDocument };
}

const row = (title: string) => within(screen.getByRole("row", { name: new RegExp(title) }));

describe("DocumentList", () => {
  beforeAll(polyfillDialog);

  it("lists the documents with their status, linking to the detail page", async () => {
    const { transport } = documentService([
      { id: "d1", title: "Quarterly report", status: DocumentStatus.READY },
      { id: "d2", title: "Notes", status: DocumentStatus.PROCESSING },
    ]);
    renderModule(documents, transport);
    const link = await screen.findByRole("link", { name: "Quarterly report" });
    expect(link.getAttribute("href")).toBe("/d1");
    expect(row("Quarterly report").getByText("Ready")).toBeTruthy();
    expect(row("Notes").getByText("Processing")).toBeTruthy();
  });

  it("offers deleting only on the user's own documents", async () => {
    const { transport } = documentService([
      { id: "d1", title: "Mine", status: DocumentStatus.READY, ownerId: "alice" },
      { id: "d2", title: "Theirs", status: DocumentStatus.READY, ownerId: "carol" },
    ]);
    renderModule(documents, transport, "/", alice);
    await screen.findByRole("link", { name: "Theirs" });
    expect(row("Mine").queryByRole("button", { name: "Delete" })).toBeTruthy();
    expect(row("Theirs").queryByRole("button", { name: "Delete" })).toBeNull();
    expect(row("Theirs").getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("deletes a document after confirming, keeping the focus in the list", async () => {
    const { transport, deleteDocument } = documentService([
      { id: "d1", title: "Quarterly report", status: DocumentStatus.READY, ownerId: "alice" },
      { id: "d2", title: "Notes", status: DocumentStatus.READY, ownerId: "alice" },
    ]);
    renderModule(documents, transport, "/", alice);
    await screen.findByRole("link", { name: "Notes" });
    const button = row("Notes").getByRole("button", { name: "Delete" });
    button.focus();
    fireEvent.click(button);
    const dialog = within(screen.getByRole("dialog", { name: "Delete document?" }));
    expect(dialog.getByText(/“Notes” and its passages will be deleted/)).toBeTruthy();
    expect(deleteDocument).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Notes" })).toBeNull());
    expect(deleteDocument.mock.calls[0]?.[0].id).toBe("d2");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("table", { name: "Documents" }));
    expect(screen.getByRole("link", { name: "Quarterly report" })).toBeTruthy();
  });

  it("keeps the document when the deletion is cancelled", async () => {
    const { transport, deleteDocument } = documentService([
      { id: "d1", title: "Notes", status: DocumentStatus.READY, ownerId: "alice" },
    ]);
    renderModule(documents, transport, "/", alice);
    await screen.findByRole("link", { name: "Notes" });
    const button = row("Notes").getByRole("button", { name: "Delete" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Notes" })).toBeTruthy();
  });

  it("points to ingestion while the knowledge base is empty", async () => {
    const { transport } = documentService([]);
    renderModule(documents, transport);
    expect(await screen.findByText("No documents yet. Upload some to get started.")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Upload documents" });
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/m/ingestion", "/m/ingestion"]);
  });

  it("shows why the documents can't be loaded", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(DocumentService, {
        listDocuments: () => {
          throw new ConnectError("document service down", Code.Unavailable);
        },
      }),
    );
    renderModule(documents, transport);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "[unavailable] document service down",
    );
  });

  it("links to the upload page", async () => {
    const { transport } = documentService([]);
    renderModule(documents, transport);
    const link = await screen.findByRole("link", { name: /Upload documents/ });
    expect(link.getAttribute("href")).toBe("/m/ingestion");
  });

  it("sorts by date or title and filters by title", async () => {
    const { transport } = documentService([
      {
        id: "d1",
        title: "Beta",
        status: DocumentStatus.READY,
        createTime: { seconds: 100n, nanos: 0 },
      },
      {
        id: "d2",
        title: "Alpha",
        status: DocumentStatus.READY,
        createTime: { seconds: 300n, nanos: 0 },
      },
      {
        id: "d3",
        title: "Gamma",
        status: DocumentStatus.READY,
        createTime: { seconds: 200n, nanos: 0 },
      },
    ]);
    renderModule(documents, transport);
    await screen.findByRole("link", { name: "Beta" });
    const titles = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((r) => within(r).getAllByRole("link")[0]?.textContent);
    expect(titles()).toEqual(["Alpha", "Gamma", "Beta"]);
    const sort = screen.getByRole("combobox", { name: "Sort by" });
    fireEvent.change(sort, { target: { value: "oldest" } });
    expect(titles()).toEqual(["Beta", "Gamma", "Alpha"]);
    fireEvent.change(sort, { target: { value: "title-asc" } });
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
    fireEvent.change(sort, { target: { value: "title-desc" } });
    expect(titles()).toEqual(["Gamma", "Beta", "Alpha"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter by title" }), {
      target: { value: "ALP" },
    });
    expect(titles()).toEqual(["Alpha"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter by title" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No documents match this title.")).toBeTruthy();
  });

  describe("paging and polling", () => {
    afterEach(() => vi.useRealTimers());

    /** `total` ready documents served `DOCUMENT_PAGE_SIZE` at a time; the token is the next offset. */
    function pagedService(total: number, status = DocumentStatus.READY) {
      const listDocuments = vi.fn(({ page }: { page?: { pageToken: string } }) => {
        const from = Number(page?.pageToken || 0);
        const to = Math.min(from + DOCUMENT_PAGE_SIZE, total);
        return {
          documents: Array.from({ length: to - from }, (_, i) => ({
            id: `d${from + i}`,
            title: `Doc ${String(from + i).padStart(3, "0")}`,
            status,
            createTime: { seconds: BigInt(from + i), nanos: 0 },
          })),
          page: { nextPageToken: to < total ? String(to) : "" },
        };
      });
      const transport = createRouterTransport(({ service }) =>
        service(DocumentService, { listDocuments }),
      );
      return { transport, listDocuments };
    }
    const rows = () => screen.getAllByRole("row").length - 1;

    it("loads the next page on demand until every document is reachable", async () => {
      const { transport, listDocuments } = pagedService(150);
      renderModule(documents, transport);
      await screen.findByRole("link", { name: "Doc 099" });
      expect(rows()).toBe(100);
      expect(screen.getByRole("status").textContent).toBe("100 documents loaded");
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await waitFor(() => expect(rows()).toBe(150));
      expect(screen.getByRole("link", { name: "Doc 000" })).toBeTruthy();
      expect(listDocuments.mock.calls.map((c) => c[0].page?.pageToken)).toEqual(["", "100"]);
      expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("table", { name: "Documents" }));
    });

    it("filters and sorts across every loaded page", async () => {
      const { transport } = pagedService(150);
      renderModule(documents, transport);
      await screen.findByRole("link", { name: "Doc 099" });
      const filter = screen.getByRole("searchbox", { name: "Filter by title" });
      fireEvent.change(filter, { target: { value: "doc 05" } });
      expect(rows()).toBe(10);
      fireEvent.change(filter, { target: { value: "doc 14" } });
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await waitFor(() => expect(rows()).toBe(10));
      fireEvent.change(filter, { target: { value: "nothing" } });
      expect(screen.getByText("No documents match this title.")).toBeTruthy();
    });

    it("says that a filter only covers the loaded documents while more remain", async () => {
      const { transport } = pagedService(150);
      renderModule(documents, transport);
      await screen.findByRole("link", { name: "Doc 099" });
      fireEvent.change(screen.getByRole("searchbox", { name: "Filter by title" }), {
        target: { value: "Doc 120" },
      });
      expect(
        screen.getByText("No loaded documents match this title. Load more to look further."),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      expect(await screen.findByRole("link", { name: "Doc 120" })).toBeTruthy();
    });

    it("polls only while a document is still being processed", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const idle = pagedService(3);
      const first = renderModule(documents, idle.transport);
      await screen.findByRole("link", { name: "Doc 002" });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(idle.listDocuments).toHaveBeenCalledTimes(1);
      first.unmount();

      const busy = pagedService(3, DocumentStatus.PROCESSING);
      renderModule(documents, busy.transport);
      await screen.findByRole("link", { name: "Doc 002" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(busy.listDocuments.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });
});
