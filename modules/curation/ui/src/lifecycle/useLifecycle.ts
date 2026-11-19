import {
  CurationService,
  type Lifecycle,
} from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import { useClient, useQuery, useQueryClient } from "@knowcel/module-sdk";

type Client = ReturnType<typeof useClient<typeof CurationService>>;
type QueryClient = ReturnType<typeof useQueryClient>;

/** What the curation module knows of a document's state. */
export interface DocumentState {
  lifecycle?: Lifecycle;
  excluded: boolean;
}

// ScoreChunks takes at most this many documents at once.
const BATCH = 100;
// Rows of a list ask one by one, within a moment of each other.
const WINDOW_MS = 20;

/**
 * Asks for many documents' states with few requests: ids asked for within a
 * moment of each other go into one ScoreChunks call. A document without a
 * score has no state; its answer is undefined.
 */
class Batcher {
  private waiting = new Map<
    string,
    { resolve: (state: DocumentState | undefined) => void; reject: (err: unknown) => void }[]
  >();
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The client of whoever asked last: it follows the transport when that changes. */
  constructor(public client: Client) {}

  get(id: string): Promise<DocumentState | undefined> {
    return new Promise((resolve, reject) => {
      this.waiting.set(id, [...(this.waiting.get(id) ?? []), { resolve, reject }]);
      this.timer ??= setTimeout(() => void this.flush(), WINDOW_MS);
    });
  }

  private async flush() {
    const waiting = this.waiting;
    this.waiting = new Map();
    this.timer = undefined;
    const ids = [...waiting.keys()];
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      try {
        const { scores } = await this.client.scoreChunks({ documentIds: batch });
        const found = new Map(scores.map((s) => [s.documentId, s]));
        for (const id of batch) {
          const s = found.get(id);
          const state = s && { lifecycle: s.lifecycle, excluded: s.excluded };
          for (const w of waiting.get(id) ?? []) w.resolve(state);
        }
      } catch (err) {
        for (const id of batch) for (const w of waiting.get(id) ?? []) w.reject(err);
      }
    }
  }
}

// One batcher for the whole app: each component has a client of its own, but they share the query cache.
const batchers = new WeakMap<QueryClient, Batcher>();

/** The state of a document, or undefined while it has none or can't be loaded. */
export function useDocumentState(documentId: string) {
  const client = useClient(CurationService);
  const cache = useQueryClient();
  return useQuery({
    queryKey: ["lifecycle", "state", documentId],
    queryFn: () => {
      let batcher = batchers.get(cache);
      if (!batcher) {
        batcher = new Batcher(client);
        batchers.set(cache, batcher);
      }
      batcher.client = client;
      return batcher.get(documentId);
    },
    retry: false,
  });
}
