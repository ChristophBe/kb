import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { DocumentService, DocumentStatus } from "@kb/document-api/kb/document/v1/document_pb";
import { renderWidget } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecentDocuments } from "./RecentDocuments.tsx";

describe("RecentDocuments", () => {
  it("lists the latest documents with links to them", async () => {
    const listDocuments = vi.fn(() => ({
      documents: [
        { id: "d1", title: "Q3 report", status: DocumentStatus.READY },
        { id: "d2", title: "", filename: "notes.md", status: DocumentStatus.PROCESSING },
      ],
    }));
    const { container } = renderWidget(
      RecentDocuments,
      createRouterTransport(({ service }) => service(DocumentService, { listDocuments })),
    );
    const link = await screen.findByRole("link", { name: "Q3 report" });
    expect(link.getAttribute("href")).toBe("/m/document/d1");
    // Without a title the filename stands in.
    expect(screen.getByRole("link", { name: "notes.md" }).getAttribute("href")).toBe(
      "/m/document/d2",
    );
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Processing")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All documents" }).getAttribute("href")).toBe(
      "/m/document",
    );
    expect(listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ page: expect.objectContaining({ pageSize: 5 }) }),
      expect.anything(),
    );
    await expectNoAxeViolations(container);
  });

  it("points to the upload when there are no documents", async () => {
    renderWidget(
      RecentDocuments,
      createRouterTransport(({ service }) =>
        service(DocumentService, { listDocuments: () => ({ documents: [] }) }),
      ),
    );
    const link = await screen.findByRole("link", { name: "Upload your first files" });
    expect(link.getAttribute("href")).toBe("/m/ingestion");
  });

  it("stays calm while the service is down and retries on request", async () => {
    let down = true;
    renderWidget(
      RecentDocuments,
      createRouterTransport(({ service }) =>
        service(DocumentService, {
          listDocuments: () => {
            if (down) throw new ConnectError("no healthy upstream", Code.Unavailable);
            return { documents: [{ id: "d1", title: "Back again" }] };
          },
        }),
      ),
    );
    expect(await screen.findByText("Your documents can't be loaded right now.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Back again" })).toBeTruthy();
  });
});
