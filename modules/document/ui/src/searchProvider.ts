import {
  DocumentService,
  type ScoredDocument,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { SearchError, type SearchProvider } from "@knowcel/module-sdk";
import { errorInfo } from "@knowcel/ui";

/** How many documents the global search asks for. */
export const SEARCH_LIMIT = 20;

/** The document, opened at its best passage, relative to the module root. */
export function passagePath(d: ScoredDocument): { pathname: string; hash: string } {
  return { pathname: d.documentId, hash: d.bestChunk ? `chunk-${d.bestChunk.index}` : "" };
}

/** The documents in the global search (see manifest.ts): each once, opened at its best passage. */
export const documentSearch: SearchProvider["search"] = async (query, signal, context) => {
  const resp = await context
    .client(DocumentService)
    .searchDocuments({ query, limit: SEARCH_LIMIT }, { signal })
    .catch(readableError);
  return resp.documents.map((d) => {
    const { pathname, hash } = passagePath(d);
    return {
      title: d.title,
      // The excerpt shows the words that matched; a hit by meaning shows its passage.
      snippet: d.excerpt || d.bestChunk?.text,
      href: `/m/document/${pathname}${hash ? `#${hash}` : ""}`,
    };
  });
};

/** Search embeds the query with the Models service; say so when that is what's down. */
function readableError(err: unknown): never {
  if (errorInfo(err)?.reason === "LLM_UNAVAILABLE")
    throw new SearchError("Search needs the Models service, which isn't available right now.", {
      cause: err,
    });
  throw err;
}
