import { createRouterTransport } from "@connectrpc/connect";
import { DocumentService, DocumentStatus } from "@kb/document-api/kb/document/v1/document_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import documents from "./index.tsx";

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
  it("shows the version and links to uploading a new one", async () => {
    renderDocument({ version: 2 });
    const row = await versionRow();
    expect(row.getByText("2")).toBeTruthy();
    const link = row.getByRole("link", { name: "Upload new version" });
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
    expect(row.queryByRole("link", { name: "Upload new version" })).toBeNull();
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
    expect(row.getByRole("link", { name: "Upload new version" })).toBeTruthy();
    // The document itself stays ready with its current version.
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("offers no new version while the first upload is processed", async () => {
    renderDocument({ version: 1, status: DocumentStatus.PROCESSING });
    const row = await versionRow();
    expect(row.queryByRole("link", { name: "Upload new version" })).toBeNull();
  });
});
