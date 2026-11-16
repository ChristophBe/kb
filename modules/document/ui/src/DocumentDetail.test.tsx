import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  DocumentService,
  DocumentStatus,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import documents from "./index.tsx";
import { alice } from "./testing.ts";

function renderDocument(document: Record<string, unknown>) {
  const transport = createRouterTransport(({ service }) =>
    service(DocumentService, {
      getDocument: () => ({
        document: {
          id: "d1",
          title: "Notes",
          filename: "notes.md",
          status: DocumentStatus.READY,
          ...document,
        },
      }),
      listChunks: () => ({ chunks: [] }),
    }),
  );
  return renderModule(documents, transport, "/d1");
}

async function versionRow() {
  const term = await screen.findByText("Version", { selector: "dt" });
  return within(term.parentElement as HTMLElement);
}

describe("DocumentDetail", () => {
  beforeAll(polyfillDialog);

  it("offers every action to the owner and asks before deleting", async () => {
    const deleteDocument = vi.fn(() => ({}));
    const transport = createRouterTransport(({ service }) =>
      service(DocumentService, {
        getDocument: () => ({
          document: { id: "d1", title: "Notes", ownerId: "alice", status: DocumentStatus.READY },
        }),
        listChunks: () => ({ chunks: [] }),
        listDocuments: () => ({ documents: [] }),
        deleteDocument,
      }),
    );
    renderModule(documents, transport, "/d1", alice);
    const bar = within(await screen.findByRole("toolbar", { name: "Document actions" }));
    expect(bar.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(bar.getByRole("link", { name: "Upload new version" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "Change access" })).toBeTruthy();
    fireEvent.click(bar.getByRole("button", { name: "Delete" }));
    const dialog = within(screen.getByRole("dialog", { name: "Delete document?" }));
    expect(deleteDocument).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("No documents yet. Upload some on the Upload page."),
    ).toBeTruthy();
    expect(deleteDocument).toHaveBeenCalledOnce();
  });

  it("shows who owns a document to someone else, without Delete", async () => {
    renderDocument({ ownerId: "carol" });
    const bar = within(await screen.findByRole("toolbar", { name: "Document actions" }));
    expect(bar.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(bar.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(bar.queryByRole("button", { name: "Change access" })).toBeNull();
    const term = screen.getByText("Owner", { selector: "dt" });
    expect(within(term.parentElement as HTMLElement).getByText("Another user")).toBeTruthy();
  });

  it("links back to Documents when the document is not found", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(DocumentService, {
        getDocument: () => {
          throw new ConnectError("not found", Code.NotFound);
        },
      }),
    );
    renderModule(documents, transport, "/d1");
    expect((await screen.findByRole("alert")).textContent).toContain("you don't have access");
    const link = screen.getByRole("link", { name: "Back to Documents" });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("shows a skeleton while the document loads", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(DocumentService, {
        getDocument: () => new Promise(() => {}),
      }),
    );
    renderModule(documents, transport, "/d1");
    expect(await screen.findByText("Loading document", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(screen.getByRole("link", { name: "← Documents" })).toBeTruthy());
  });

  it("shows the version and links to uploading a new one", async () => {
    renderDocument({ version: 2 });
    const row = await versionRow();
    expect(row.getByText("2")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Upload new version" });
    expect(link.getAttribute("href")).toBe("/m/ingestion/replace/d1");
  });

  it("shows a new version being processed, without offering another", async () => {
    renderDocument({
      version: 1,
      pendingVersion: { version: 2, filename: "notes-v2.md", status: DocumentStatus.PROCESSING },
    });
    const row = await versionRow();
    expect(row.getByText("Version 2 (notes-v2.md):")).toBeTruthy();
    expect(row.getByText("Processing")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Upload new version" })).toBeNull();
  });

  it("shows why a new version failed and offers to try again", async () => {
    renderDocument({
      version: 1,
      pendingVersion: {
        version: 2,
        filename: "notes-v2.md",
        status: DocumentStatus.FAILED,
        statusDetail: "document contains no text",
      },
    });
    const row = await versionRow();
    expect(row.getByText("Failed")).toBeTruthy();
    expect(row.getByText("document contains no text")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upload new version" })).toBeTruthy();
    // The document itself stays ready with its current version.
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("offers no new version while the first upload is processed", async () => {
    renderDocument({ version: 1, status: DocumentStatus.PROCESSING });
    await versionRow();
    expect(screen.queryByRole("link", { name: "Upload new version" })).toBeNull();
  });
});
