import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import {
  DocumentService,
  type SearchDocumentsRequest,
  type SearchDocumentsResponseSchema,
} from "@kb/document-api/kb/document/v1/document_pb";
import { SearchError } from "@kb/module-sdk";
import { renderWithRuntime } from "@kb/module-sdk/testing";
import { errorInfoDetail } from "@kb/ui/testing/errors";
import { screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
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

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

// Through the manifest's group, which loads documentSearch on the first search.
const search = (transport: ReturnType<typeof searchService>["transport"]) =>
  documents.search?.search("revenue", new AbortController().signal, {
    client: (s) => createClient(s, transport),
  });

describe("Search", () => {
  it("sends old links to the shell's search page, keeping the query", async () => {
    const { transport, searchDocuments } = searchService(() => ({ documents: [] }));
    const router = createMemoryRouter(
      [
        { path: "/m/document", children: documents.routes },
        { path: "/search", element: <Where /> },
      ],
      { initialEntries: ["/m/document/search?q=foo"] },
    );
    renderWithRuntime(<RouterProvider router={router} />, transport);
    expect((await screen.findByTestId("where")).textContent).toBe("/search?q=foo");
    // Replaced, so Back doesn't bounce back to the redirect.
    expect(router.state.historyAction).toBe("REPLACE");
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it("leaves the search out of the module's navigation and points its entry points at /search", () => {
    expect(documents.nav).toBeUndefined();
    expect(documents.feature?.cta.path).toBe("/search");
  });

  it("puts each document once under Documents in the global search", async () => {
    const { transport, searchDocuments } = searchService(() => ({
      results: [chunkOf(hit, 3, 0.82), chunkOf(hit, 5, 0.7)],
      documents: [hit, other],
    }));
    const hits = await search(transport);
    expect(documents.search?.label).toBe("Documents");
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

  it("explains that search needs the Models service while it is down", async () => {
    const { transport } = searchService(() => {
      const err = new ConnectError("the llm service is unavailable", Code.Unavailable);
      err.details.push(errorInfoDetail({ reason: "LLM_UNAVAILABLE", domain: "kb.document.v1" }));
      throw err;
    });
    const err = await search(transport)?.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect((err as SearchError).message).toBe(
      "Search needs the Models service, which isn't available right now.",
    );
  });

  it("passes other failures on as they are", async () => {
    const { transport } = searchService(() => {
      throw new ConnectError("down", Code.Unavailable);
    });
    const err = await search(transport)?.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect(err).not.toBeInstanceOf(SearchError);
  });
});
