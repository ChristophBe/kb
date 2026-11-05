import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  DocumentService,
  type SearchDocumentsRequest,
  type SearchDocumentsResponseSchema,
} from "@kb/document-api/kb/document/v1/document_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import documents from "./index.tsx";
import { SEARCH_LIMIT } from "./Search.tsx";

const hit = {
  chunk: { documentId: "d1", index: 3, text: "Revenue in Q3 grew by 12 %.", metadata: {} },
  documentTitle: "Quarterly report",
  score: 0.8231,
};

function searchService(answer: () => MessageInitShape<typeof SearchDocumentsResponseSchema>) {
  const searchDocuments = vi.fn((_req: SearchDocumentsRequest) => answer());
  const transport = createRouterTransport(({ service }) =>
    service(DocumentService, { searchDocuments }),
  );
  return { transport, searchDocuments };
}

const field = () => screen.getByRole("searchbox", { name: "Search documents" });

function search(text: string) {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

describe("Search", () => {
  it("lists matching passages, each linking to its chunk", async () => {
    const { transport, searchDocuments } = searchService(() => ({ results: [hit] }));
    const { container } = renderModule(documents, transport, "/search");
    search("  revenue growth ");

    const link = await screen.findByRole("link", { name: "Quarterly report, chunk 4" });
    expect(link.getAttribute("href")).toBe("/d1#chunk-3");
    expect(screen.getByText("Revenue in Q3 grew by 12 %.")).toBeTruthy();
    expect(screen.getByText("0.82")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe('1 result for "revenue growth"');
    expect(searchDocuments.mock.calls[0]?.[0]).toMatchObject({
      query: "revenue growth",
      limit: SEARCH_LIMIT,
    });
    await expectNoAxeViolations(container);
  });

  it("runs the search from the URL", async () => {
    const { transport, searchDocuments } = searchService(() => ({ results: [hit, hit] }));
    renderModule(documents, transport, "/search?q=revenue");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe('2 results for "revenue"'),
    );
    expect((field() as HTMLInputElement).value).toBe("revenue");
    expect(searchDocuments).toHaveBeenCalledTimes(1);
  });

  it("asks for a search term instead of sending an empty query", async () => {
    const { transport, searchDocuments } = searchService(() => ({ results: [] }));
    renderModule(documents, transport, "/search");
    search("   ");
    expect(screen.getByText("Enter a search term")).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field());
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it("says when nothing matches", async () => {
    const { transport } = searchService(() => ({ results: [] }));
    renderModule(documents, transport, "/search?q=zebra");
    expect(await screen.findByText('No passages match "zebra". Try other words.')).toBeTruthy();
  });

  it("explains that search needs the Models service", async () => {
    const { transport } = searchService(() => {
      throw new ConnectError("the llm service is unavailable", Code.Unavailable);
    });
    renderModule(documents, transport, "/search?q=revenue");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Search needs the Models service, which isn't available right now.",
    );
  });

  it("is in the module's navigation", () => {
    expect(documents.nav?.map((n) => n.path)).toEqual(["", "search"]);
  });
});
