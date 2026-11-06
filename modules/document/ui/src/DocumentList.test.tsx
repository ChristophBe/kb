import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { DocumentService, DocumentStatus } from "@kb/document-api/kb/document/v1/document_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { polyfillDialog } from "@kb/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import documents from "./index.tsx";

/** A document service backed by an in-memory list. */
function documentService(initial: { id: string; title: string; status: DocumentStatus }[]) {
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

  it("deletes a document after confirming, keeping the focus in the list", async () => {
    const { transport, deleteDocument } = documentService([
      { id: "d1", title: "Quarterly report", status: DocumentStatus.READY },
      { id: "d2", title: "Notes", status: DocumentStatus.READY },
    ]);
    renderModule(documents, transport);
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
      { id: "d1", title: "Notes", status: DocumentStatus.READY },
    ]);
    renderModule(documents, transport);
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
    expect(await screen.findByText("No documents yet. Upload some in Ingestion.")).toBeTruthy();
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
});
