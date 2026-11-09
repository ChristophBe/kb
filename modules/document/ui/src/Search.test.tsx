import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
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
import { SEARCH_LIMIT } from "./searchProvider.ts";

const hit = {
  documentId: "d1",
  title: "Quarterly report",
  score: 0.8231,
  bestChunk: { documentId: "d1", index: 3, text: "Revenue in Q3 grew by 12 %.", metadata: {} },
};

const other = {
  documentId: "d2",
  title: "Board minutes",
  score: 0.61,
  bestChunk: { documentId: "d2", index: 0, text: "Revenue was discussed.", metadata: {} },
};

const chunkOf = (d: typeof hit, index: number, score: number) => ({
  chunk: { ...d.bestChunk, index },
  documentTitle: d.title,
  score,
});

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
  it("lists matching documents, each linking to its best passage", async () => {
    const { transport, searchDocuments } = searchService(() => ({ documents: [hit] }));
    const { container } = renderModule(documents, transport, "/search");
    search("  revenue growth ");

    const link = await screen.findByRole("link", { name: "Quarterly report" });
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

  it("shows each document once, in the order of its best passage", async () => {
    // Five passages of the report match; the document list has it once.
    const { transport } = searchService(() => ({
      results: [0, 1, 2, 3, 4]
        .map((i) => chunkOf(hit, i, 0.8 - i / 100))
        .concat(chunkOf(other, 0, 0.6)),
      documents: [hit, other],
    }));
    renderModule(documents, transport, "/search?q=revenue");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe('2 results for "revenue"'),
    );
    const links = screen.getAllByRole("link").map((l) => l.textContent);
    expect(links).toEqual(["Quarterly report", "Board minutes"]);
    expect(screen.getAllByText("Revenue in Q3 grew by 12 %.")).toHaveLength(1);
  });

  it("runs the search from the URL", async () => {
    const { transport, searchDocuments } = searchService(() => ({ documents: [hit, other] }));
    renderModule(documents, transport, "/search?q=revenue");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe('2 results for "revenue"'),
    );
    expect((field() as HTMLInputElement).value).toBe("revenue");
    expect(searchDocuments).toHaveBeenCalledTimes(1);
  });

  it("asks for a search term instead of sending an empty query", async () => {
    const { transport, searchDocuments } = searchService(() => ({ documents: [] }));
    renderModule(documents, transport, "/search");
    search("   ");
    expect(screen.getByText("Enter a search term")).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field());
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it("says when nothing matches", async () => {
    const { transport } = searchService(() => ({ documents: [] }));
    renderModule(documents, transport, "/search?q=zebra");
    expect(await screen.findByText('No documents match "zebra". Try other words.')).toBeTruthy();
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

  it("puts each document once under Documents in the global search", async () => {
    const { transport, searchDocuments } = searchService(() => ({
      results: [chunkOf(hit, 3, 0.82), chunkOf(hit, 5, 0.7)],
      documents: [hit, other],
    }));
    const signal = new AbortController().signal;
    // Through the manifest's group, which loads documentSearch on the first search.
    expect(documents.search?.label).toBe("Documents");
    const hits = await documents.search?.search("revenue", signal, {
      client: (s) => createClient(s, transport),
    });
    expect(hits).toEqual([
      {
        title: "Quarterly report",
        snippet: "Revenue in Q3 grew by 12 %.",
        href: "/m/document/d1#chunk-3",
      },
      { title: "Board minutes", snippet: "Revenue was discussed.", href: "/m/document/d2#chunk-0" },
    ]);
    expect(searchDocuments.mock.calls[0]?.[0]).toMatchObject({
      query: "revenue",
      limit: SEARCH_LIMIT,
    });
  });

  it("is in the module's navigation", () => {
    expect(documents.nav?.map((n) => n.path)).toEqual(["", "search"]);
  });
});
