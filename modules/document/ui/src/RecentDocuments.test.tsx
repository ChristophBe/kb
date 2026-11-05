import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  type Document,
  DocumentSchema,
  DocumentService,
  DocumentStatus,
} from "@kb/document-api/kb/document/v1/document_pb";
import { renderWidget } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentDocuments } from "./RecentDocuments.tsx";

function service(listDocuments: () => { documents: Document[] }) {
  return createRouterTransport(({ service }) => service(DocumentService, { listDocuments }));
}

describe("RecentDocuments", () => {
  it("links the latest documents with their status", async () => {
    const { container } = renderWidget(
      RecentDocuments,
      service(() => ({
        documents: [
          create(DocumentSchema, { id: "d1", title: "report.pdf", status: DocumentStatus.READY }),
          create(DocumentSchema, {
            id: "d2",
            title: "notes.md",
            status: DocumentStatus.PROCESSING,
          }),
        ],
      })),
    );
    const report = await screen.findByRole("link", { name: /report\.pdf/ });
    expect(report.getAttribute("href")).toBe("/m/document/d1");
    expect(report.textContent).toContain("Ready");
    expect(screen.getByRole("link", { name: /notes\.md/ }).textContent).toContain("Processing");
    expect(screen.getByRole("link", { name: "All documents" }).getAttribute("href")).toBe(
      "/m/document",
    );
    await expectNoAxeViolations(container);
  });

  it("points to the upload when there are none", async () => {
    renderWidget(
      RecentDocuments,
      service(() => ({ documents: [] })),
    );
    const link = await screen.findByRole("link", { name: "Upload one to get started." });
    expect(link.getAttribute("href")).toBe("/m/ingestion");
  });

  it("says documents are unavailable when the service is down", async () => {
    renderWidget(
      RecentDocuments,
      service(() => {
        throw new ConnectError("down", Code.Unavailable);
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("not available right now");
  });
});
