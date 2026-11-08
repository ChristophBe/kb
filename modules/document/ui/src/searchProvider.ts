import { DocumentService, type ScoredDocument } from "@kb/document-api/kb/document/v1/document_pb";
import type { SearchProvider } from "@kb/module-sdk";

/** How many documents a search asks for, on the Search page and in the global search. */
export const SEARCH_LIMIT = 20;

/** The document, opened at its best passage, relative to the module root. */
export function passagePath(d: ScoredDocument): { pathname: string; hash: string } {
  return { pathname: d.documentId, hash: d.bestChunk ? `chunk-${d.bestChunk.index}` : "" };
}

/** The documents in the global search: each once, opened at its best passage. */
export const documentSearch: SearchProvider = {
  label: "Documents",
  search: async (query, signal, context) => {
    const resp = await context
      .client(DocumentService)
      .searchDocuments({ query, limit: SEARCH_LIMIT }, { signal });
    return resp.documents.map((d) => {
      const { pathname, hash } = passagePath(d);
      return {
        title: d.title,
        snippet: d.bestChunk?.text,
        href: `/m/document/${pathname}${hash ? `#${hash}` : ""}`,
      };
    });
  },
};
