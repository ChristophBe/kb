import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

// In-memory mock data for the M1 prototype (docs/ux/m1). Nothing is sent to a
// backend; changes last until the page is reloaded.

export type DocStatus = "ready" | "processing" | "failed";

export interface Chunk {
  index: number;
  page: number;
  text: string;
}

export interface MetadataField {
  key: string;
  value: string;
}

export interface Doc {
  id: string;
  title: string;
  filename: string;
  status: DocStatus;
  sizeBytes: number;
  contentType: string;
  added: Date;
  metadata: MetadataField[];
  chunks: Chunk[];
  error?: string;
}

export interface Citation {
  n: number;
  documentId: string;
  chunkIndex: number;
  title: string;
}

export type MessageState = "complete" | "streaming" | "stopped" | "failed";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  state: MessageState;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  scope: string[];
  messages: Message[];
  updated: Date;
}

const sentences = {
  report: [
    "Revenue in Q3 grew by 12 % compared to the previous quarter, reaching 4.2 million euros.",
    "Product A contributed most of the growth with an increase of 8 %, driven by the new subscription tier.",
    "Operating costs rose by 3 %, mainly because of two new hires in customer support.",
    "The gross margin improved to 61 % after renegotiating the hosting contract.",
    "Churn fell to 2.1 % per month, the lowest value since the product launch.",
    "For Q4 the team expects flat revenue because of seasonal effects in December.",
  ],
  minutes: [
    "The board approved the budget for the Berlin office move in January.",
    "Discussion of revenue growth: the growth was mainly driven by existing customers upgrading.",
    "The hiring plan for 2027 foresees four engineers and one designer.",
    "Action item: finance prepares a cash-flow forecast for the next board meeting.",
  ],
  onboarding: [
    "Welcome to the team. Your laptop is ready at the front desk on your first day.",
    "Every new colleague gets a buddy who answers questions during the first four weeks.",
    "Expense reports are submitted through the finance portal before the 5th of each month.",
    "Remote work is possible up to three days per week after the probation period.",
  ],
};

function makeChunks(pool: string[], count: number): Chunk[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    page: Math.floor(i / 3) + 1,
    text: [0, 1, 2].map((k) => pool[(i + k) % pool.length]).join(" "),
  }));
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

function initialDocs(): Doc[] {
  return [
    {
      id: "d1",
      title: "Quarterly report Q3",
      filename: "quarterly-report-q3.pdf",
      status: "ready",
      sizeBytes: 1_250_000,
      contentType: "application/pdf",
      added: minutesAgo(2),
      metadata: [
        { key: "source", value: "finance" },
        { key: "year", value: "2026" },
      ],
      chunks: makeChunks(sentences.report, 42),
    },
    {
      id: "d2",
      title: "Board minutes October",
      filename: "board-minutes-october.md",
      status: "ready",
      sizeBytes: 14_200,
      contentType: "text/markdown",
      added: minutesAgo(65),
      metadata: [{ key: "source", value: "board" }],
      chunks: makeChunks(sentences.minutes, 8),
    },
    {
      id: "d3",
      title: "Onboarding notes",
      filename: "onboarding-notes.md",
      status: "processing",
      sizeBytes: 9_800,
      contentType: "text/markdown",
      added: minutesAgo(5),
      metadata: [],
      chunks: [],
    },
    {
      id: "d4",
      title: "broken-scan.pdf",
      filename: "broken-scan.pdf",
      status: "failed",
      sizeBytes: 3_400_000,
      contentType: "application/pdf",
      added: minutesAgo(60 * 26),
      metadata: [],
      chunks: [],
      error: "No text found. The PDF may be a scan without a text layer.",
    },
  ];
}

function initialConversations(): Conversation[] {
  return [
    {
      id: "c1",
      title: "Q3 revenue questions",
      scope: ["d1", "d2"],
      updated: minutesAgo(10),
      messages: [
        {
          id: "m1",
          role: "user",
          content: "How did revenue develop in Q3?",
          citations: [],
          state: "complete",
        },
        {
          id: "m2",
          role: "assistant",
          content:
            "Revenue grew by **12 %** in Q3 [1], mainly driven by existing customers upgrading [2].\n\n- Product A: +8 % [1]\n- Gross margin: 61 % [1]\n\nFor Q4 the team expects **flat revenue** because of seasonal effects [1].",
          citations: [
            { n: 1, documentId: "d1", chunkIndex: 1, title: "Quarterly report Q3" },
            { n: 2, documentId: "d2", chunkIndex: 2, title: "Board minutes October" },
          ],
          state: "complete",
        },
      ],
    },
    { id: "c2", title: "Onboarding", scope: [], updated: minutesAgo(90), messages: [] },
  ];
}

let counter = 100;
export const newId = (prefix: string) => `${prefix}${++counter}`;

interface Store {
  docs: Doc[];
  conversations: Conversation[];
  updateDoc: (id: string, patch: Partial<Doc>) => void;
  addDoc: (doc: Doc) => void;
  deleteDoc: (id: string) => Doc | undefined;
  restoreDoc: (doc: Doc) => void;
  createConversation: (scope: string[]) => Conversation;
  updateConversation: (id: string, update: (c: Conversation) => Conversation) => void;
  deleteConversation: (id: string) => void;
  reset: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [docs, setDocs] = useState(initialDocs);
  const [conversations, setConversations] = useState(initialConversations);

  const updateDoc = useCallback(
    (id: string, patch: Partial<Doc>) =>
      setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    [],
  );
  const addDoc = useCallback((doc: Doc) => setDocs((ds) => [doc, ...ds]), []);
  const deleteDoc = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id);
      setDocs((ds) => ds.filter((d) => d.id !== id));
      return doc;
    },
    [docs],
  );
  const restoreDoc = useCallback(
    (doc: Doc) =>
      setDocs((ds) => [...ds, doc].sort((a, b) => b.added.getTime() - a.added.getTime())),
    [],
  );
  const createConversation = useCallback((scope: string[]) => {
    const conv: Conversation = {
      id: newId("c"),
      title: "",
      scope,
      messages: [],
      updated: new Date(),
    };
    setConversations((cs) => [conv, ...cs]);
    return conv;
  }, []);
  const updateConversation = useCallback(
    (id: string, update: (c: Conversation) => Conversation) =>
      setConversations((cs) => cs.map((c) => (c.id === id ? update(c) : c))),
    [],
  );
  const deleteConversation = useCallback(
    (id: string) => setConversations((cs) => cs.filter((c) => c.id !== id)),
    [],
  );
  const reset = useCallback(() => {
    setDocs(initialDocs());
    setConversations(initialConversations());
  }, []);

  const store = useMemo<Store>(
    () => ({
      docs,
      conversations,
      updateDoc,
      addDoc,
      deleteDoc,
      restoreDoc,
      createConversation,
      updateConversation,
      deleteConversation,
      reset,
    }),
    [
      docs,
      conversations,
      updateDoc,
      addDoc,
      deleteDoc,
      restoreDoc,
      createConversation,
      updateConversation,
      deleteConversation,
      reset,
    ],
  );
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("StoreProvider is missing");
  }
  return store;
}

/** Zero-based positions of a document's chunks cited in any conversation. */
export function citedChunks(conversations: Conversation[], documentId: string): number[] {
  const cited = conversations
    .flatMap((c) => c.messages.flatMap((m) => m.citations))
    .filter((c) => c.documentId === documentId)
    .map((c) => c.chunkIndex - 1);
  return [...new Set(cited)];
}

/** Text chunks that mention any word of the query, best match first. */
export function searchChunks(docs: Doc[], query: string, scope: string[] = []) {
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) {
    return [];
  }
  return docs
    .filter((d) => d.status === "ready" && (scope.length === 0 || scope.includes(d.id)))
    .flatMap((d) =>
      d.chunks.map((c) => {
        const text = c.text.toLowerCase();
        const hits = words.filter((w) => text.includes(w)).length;
        return { doc: d, chunk: c, score: hits / words.length };
      }),
    )
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
    .slice(0, 8);
}
