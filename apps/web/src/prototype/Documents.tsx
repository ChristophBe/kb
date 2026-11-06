import {
  Badge,
  Button,
  buttonClass,
  Card,
  ChunkStrip,
  EmptyState,
  formatBytes,
  Input,
  PageHeader,
  PageTitle,
  type Tone,
} from "@kb/ui";
import { MessageSquare, Search as SearchIcon, Upload } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import {
  citedChunks,
  type Doc,
  type DocStatus,
  type MetadataField,
  searchChunks,
  useStore,
} from "./store.tsx";
import {
  Dialog,
  LoadState,
  MenuButton,
  Skeleton,
  SkeletonRows,
  Tabs,
  Time,
  useAnnouncer,
  useMockQuery,
  useToast,
} from "./ui.tsx";

const statusBadge: Record<DocStatus, [string, Tone]> = {
  ready: ["Ready", "success"],
  processing: ["Processing", "warning"],
  failed: ["Failed", "danger"],
};

function StatusBadge({ status }: { status: DocStatus }) {
  const [label, tone] = statusBadge[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Delete confirmation shared by the list and the detail page. */
function useDeleteDocument(onDeleted?: () => void) {
  const { deleteDoc, restoreDoc } = useStore();
  const toast = useToast();
  const [doc, setDoc] = useState<Doc | null>(null);
  const dialog = (
    <Dialog
      open={doc !== null}
      onClose={() => setDoc(null)}
      title={`Delete "${doc?.title ?? ""}"?`}
      footer={
        <>
          <Button variant="secondary" autoFocus onClick={() => setDoc(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="border border-danger"
            onClick={() => {
              if (!doc) {
                return;
              }
              const removed = deleteDoc(doc.id);
              setDoc(null);
              onDeleted?.();
              toast("success", "Document deleted", {
                label: "Undo delete",
                onSelect: () => removed && restoreDoc(removed),
              });
            }}
          >
            Delete document
          </Button>
        </>
      }
    >
      The document, its {doc?.chunks.length ?? 0} chunks and its citations in chats will be removed.
      This can't be undone.
    </Dialog>
  );
  return [dialog, setDoc] as const;
}

export function DocumentList() {
  const { docs, conversations, createConversation } = useStore();
  const navigate = useNavigate();
  const state = useMockQuery(docs, [], "The document service");
  const [dialog, confirmDelete] = useDeleteDocument();
  return (
    <div>
      <PageHeader
        eyebrow="kb / documents"
        title="Documents"
        description="All documents in the knowledge base."
        actions={
          <>
            <Link to="../search" relative="path" className={buttonClass("secondary")}>
              <SearchIcon className="size-4" aria-hidden="true" /> Search
            </Link>
            <Link
              to="../ingestion"
              relative="path"
              className="inline-flex items-center gap-2 rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
            >
              <Upload className="size-4" aria-hidden="true" /> Upload documents
            </Link>
          </>
        }
      />
      <Card>
        <LoadState state={state} label="Loading documents" skeleton={<SkeletonRows />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>
                No documents yet.{" "}
                <Link to="../ingestion" relative="path" className="font-medium underline">
                  Upload documents
                </Link>{" "}
                to get started.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs text-fg-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Title
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                        Size
                      </th>
                      <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                        Added
                      </th>
                      <th scope="col" className="px-4 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((d) => (
                      <tr key={d.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">
                          <Link to={d.id} className="font-medium hover:underline">
                            {d.title}
                          </Link>
                          {d.chunks.length > 0 && (
                            <ChunkStrip
                              className="mt-1 flex"
                              count={d.chunks.length}
                              marked={citedChunks(conversations, d.id)}
                            />
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="hidden px-4 py-2 font-mono text-fg-muted tabular-nums sm:table-cell">
                          {formatBytes(BigInt(d.sizeBytes))}
                        </td>
                        <td className="hidden px-4 py-2 text-fg-muted sm:table-cell">
                          <Time date={d.added} />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <MenuButton
                            label={`Actions for ${d.title}`}
                            items={[
                              { label: "Open", onSelect: () => navigate(d.id) },
                              {
                                label: "Chat about this document",
                                onSelect: () =>
                                  navigate(`../chat/${createConversation([d.id]).id}`, {
                                    relative: "path",
                                  }),
                              },
                              { label: "Delete", danger: true, onSelect: () => confirmDelete(d) },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </LoadState>
      </Card>
      {dialog}
    </div>
  );
}

type Tab = "details" | "chunks";
const PAGE_SIZE = 10;

export function DocumentDetail() {
  const { id = "" } = useParams();
  const { docs, conversations, createConversation } = useStore();
  const navigate = useNavigate();
  const doc = docs.find((d) => d.id === id);
  const state = useMockQuery(doc, doc, "The document service");
  const [dialog, confirmDelete] = useDeleteDocument(() => navigate("..", { relative: "path" }));
  const toast = useToast();

  return (
    <div>
      <Link to=".." relative="path" className="text-sm text-fg-muted hover:underline">
        ← Documents
      </Link>
      <LoadState
        state={state}
        label="Loading document"
        skeleton={
          <div className="mt-4 space-y-3">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-4 w-96" />
            <Skeleton className="h-40" />
          </div>
        }
      >
        {(d) =>
          !d ? (
            <div className="mt-4">
              <PageTitle>Document not found</PageTitle>
              <p className="mt-2 text-sm text-fg-muted">It may have been deleted.</p>
            </div>
          ) : (
            <div className="mt-2">
              <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <EditableTitle doc={d} />
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                    <StatusBadge status={d.status} />{" "}
                    <span className="font-mono tabular-nums">
                      {formatBytes(BigInt(d.sizeBytes))}
                    </span>{" "}
                    · {d.contentType} · added <Time date={d.added} />
                  </p>
                  {d.chunks.length > 0 && (
                    <ChunkStrip
                      className="mt-3 flex"
                      count={d.chunks.length}
                      marked={citedChunks(conversations, d.id)}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      navigate(`../../chat/${createConversation([d.id]).id}`, { relative: "path" })
                    }
                  >
                    <MessageSquare className="size-4" aria-hidden="true" /> Chat about this document
                  </Button>
                  <MenuButton
                    label="More actions"
                    items={[
                      {
                        label: "Download original",
                        onSelect: () => toast("info", `Download of ${d.filename} started (mock)`),
                      },
                      { label: "Delete", danger: true, onSelect: () => confirmDelete(d) },
                    ]}
                  />
                </div>
              </div>
              <DocumentTabs doc={d} />
            </div>
          )
        }
      </LoadState>
      {dialog}
    </div>
  );
}

function EditableTitle({ doc }: { doc: Doc }) {
  const { updateDoc } = useStore();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doc.title);
  const [error, setError] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const [announcer, announce] = useAnnouncer();
  const errorId = useId();

  const finish = (saved: boolean) => {
    setEditing(false);
    setError("");
    if (saved) {
      announce("Title saved");
    }
    setTimeout(() => editButton.current?.focus());
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) {
      setError("Title must not be empty");
      return;
    }
    updateDoc(doc.id, { title: value.trim() });
    finish(true);
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <PageTitle>{doc.title}</PageTitle>
        <Button
          ref={editButton}
          variant="ghost"
          onClick={() => {
            setValue(doc.title);
            setEditing(true);
          }}
        >
          Edit title
        </Button>
        {announcer}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
      <h1 className="sr-only">{doc.title}</h1>
      <div className="w-80 max-w-full">
        <label htmlFor="doc-title" className="sr-only">
          Title
        </label>
        <Input
          id="doc-title"
          autoFocus
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && finish(false)}
        />
        {error && (
          <p id={errorId} className="mt-1 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <Button type="submit">Save</Button>
      <Button variant="secondary" onClick={() => finish(false)}>
        Cancel
      </Button>
    </form>
  );
}

function DocumentTabs({ doc }: { doc: Doc }) {
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const linkedChunk = Number(hash.match(/^#chunk-(\d+)$/)?.[1] ?? 0);
  const tab: Tab = linkedChunk || params.get("tab") === "chunks" ? "chunks" : "details";
  return (
    <Tabs
      label="Document views"
      tabs={[
        { id: "details", label: "Details" },
        { id: "chunks", label: `Chunks (${doc.chunks.length})` },
      ]}
      value={tab}
      onChange={(t) => setParams(t === "chunks" ? { tab: "chunks" } : {}, { replace: true })}
    >
      {tab === "details" ? <Details doc={doc} /> : <Chunks doc={doc} linked={linkedChunk} />}
    </Tabs>
  );
}

function Details({ doc }: { doc: Doc }) {
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const rows: [string, React.ReactNode][] = [
    ["Filename", doc.filename],
    ["Status", <StatusBadge key="s" status={doc.status} />],
    [
      "Metadata",
      doc.metadata.length ? doc.metadata.map((m) => `${m.key}: ${m.value}`).join(" · ") : "None",
    ],
  ];
  return (
    <Card className="max-w-2xl">
      <dl className="divide-y divide-dotted divide-border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8rem_1fr] gap-4 px-4 py-2">
            <dt className="text-fg-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit metadata
        </Button>
        <Button
          variant="ghost"
          onClick={() => toast("info", `Download of ${doc.filename} started (mock)`)}
        >
          Download original
        </Button>
      </div>
      {editing && <MetadataDialog doc={doc} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function MetadataDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { updateDoc } = useStore();
  const toast = useToast();
  const [fields, setFields] = useState<MetadataField[]>(
    doc.metadata.length ? doc.metadata : [{ key: "", value: "" }],
  );
  const [errors, setErrors] = useState<Record<number, string>>({});
  const form = useRef<HTMLFormElement>(null);

  const focusKey = (i: number) =>
    setTimeout(() => form.current?.querySelector<HTMLInputElement>(`#meta-key-${i}`)?.focus());
  const save = (e: FormEvent) => {
    e.preventDefault();
    const found: Record<number, string> = {};
    const seen = new Map<string, number>();
    fields.forEach((f, i) => {
      const key = f.key.trim();
      if (!key && f.value.trim()) {
        found[i] = "Key must not be empty";
      } else if (key && seen.has(key)) {
        found[i] = `Key "${key}" is used twice`;
      }
      seen.set(key, i);
    });
    setErrors(found);
    const first = Object.keys(found).map(Number)[0];
    if (first !== undefined) {
      focusKey(first);
      return;
    }
    updateDoc(doc.id, { metadata: fields.filter((f) => f.key.trim()) });
    onClose();
    toast("success", "Metadata saved");
  };
  const set = (i: number, patch: Partial<MetadataField>) =>
    setFields((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit metadata"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="metadata-form">
            Save
          </Button>
        </>
      }
    >
      <form id="metadata-form" ref={form} onSubmit={save} noValidate className="space-y-3">
        {fields.map((f, i) => (
          <fieldset key={i} className="space-y-1">
            <legend className="sr-only">Field {i + 1}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={`meta-key-${i}`} className="text-xs text-fg-muted">
                  Key
                </label>
                <Input
                  id={`meta-key-${i}`}
                  value={f.key}
                  aria-invalid={errors[i] ? true : undefined}
                  aria-describedby={errors[i] ? `meta-error-${i}` : undefined}
                  onChange={(e) => set(i, { key: e.target.value })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor={`meta-value-${i}`} className="text-xs text-fg-muted">
                  Value
                </label>
                <Input
                  id={`meta-value-${i}`}
                  value={f.value}
                  onChange={(e) => set(i, { value: e.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                aria-label={`Remove ${f.key || `field ${i + 1}`}`}
                onClick={() => {
                  setFields((fs) => fs.filter((_, k) => k !== i));
                  setErrors({});
                  focusKey(i);
                }}
              >
                Remove
              </Button>
            </div>
            {errors[i] && (
              <p id={`meta-error-${i}`} className="text-sm text-danger">
                {errors[i]}
              </p>
            )}
          </fieldset>
        ))}
        <Button
          variant="secondary"
          onClick={() => {
            setFields((fs) => [...fs, { key: "", value: "" }]);
            focusKey(fields.length);
          }}
        >
          + Add field
        </Button>
      </form>
    </Dialog>
  );
}

function Chunks({ doc, linked }: { doc: Doc; linked: number }) {
  const [page, setPage] = useState(() => (linked ? Math.floor((linked - 1) / PAGE_SIZE) : 0));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  const [announcer, announce] = useAnnouncer();
  const pages = Math.max(1, Math.ceil(doc.chunks.length / PAGE_SIZE));
  const visible = doc.chunks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    if (!linked) {
      return;
    }
    const target = document.getElementById(`chunk-${linked}`);
    target?.scrollIntoView({ block: "center" });
    target?.querySelector<HTMLElement>("h3")?.focus();
  }, [linked]);

  const goTo = (p: number) => {
    setPage(p);
    const from = p * PAGE_SIZE + 1;
    const to = Math.min((p + 1) * PAGE_SIZE, doc.chunks.length);
    announce(`Showing ${from}–${to} of ${doc.chunks.length}`);
    setTimeout(() => list.current?.querySelector<HTMLElement>("h3")?.focus());
  };

  if (doc.status === "failed") {
    return (
      <EmptyState>
        Processing failed: {doc.error}{" "}
        <Link to="../../ingestion" relative="path" className="font-medium underline">
          Retry in Ingestion
        </Link>
      </EmptyState>
    );
  }
  if (doc.chunks.length === 0) {
    return (
      <EmptyState>
        This document has no chunks yet. They appear once processing has finished.
      </EmptyState>
    );
  }
  return (
    <div>
      <div
        ref={list}
        className="divide-y divide-dotted divide-border rounded-card border border-border bg-surface"
      >
        {visible.map((c) => {
          const open = expanded.has(c.index);
          return (
            <article
              key={c.index}
              id={`chunk-${c.index}`}
              className={`px-4 py-3 ${c.index === linked ? "bg-info-subtle" : ""}`}
            >
              <h3 tabIndex={-1} className="text-sm font-medium">
                Chunk {c.index}{" "}
                <span className="font-normal text-fg-muted">
                  · page {c.page} · {c.text.length} characters
                </span>
              </h3>
              <p className={`mt-1 text-sm ${open ? "" : "line-clamp-2"}`}>{c.text}</p>
              <button
                type="button"
                className="mt-1 text-sm text-fg-muted underline"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    next.has(c.index) ? next.delete(c.index) : next.add(c.index);
                    return next;
                  })
                }
              >
                {open ? "Show less" : "Show full chunk"}
              </button>
            </article>
          );
        })}
      </div>
      <nav aria-label="Chunk pages" className="mt-3 flex items-center justify-between text-sm">
        <span className="text-fg-muted">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, doc.chunks.length)} of{" "}
          {doc.chunks.length}
        </span>
        <span className="flex gap-2">
          <Button variant="secondary" disabled={page === 0} onClick={() => goTo(page - 1)}>
            Previous
          </Button>
          <Button variant="secondary" disabled={page >= pages - 1} onClick={() => goTo(page + 1)}>
            Next
          </Button>
        </span>
      </nav>
      {announcer}
    </div>
  );
}

export function Search() {
  const { docs } = useStore();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [value, setValue] = useState(q);
  const [error, setError] = useState("");
  const results = searchChunks(docs, q);
  const state = useMockQuery(results, [], "Search needs the Models service, which");
  const errorId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) {
      setError("Enter a search term");
      return;
    }
    setError("");
    setParams({ q: value.trim() });
  };
  return (
    <div>
      <PageHeader
        eyebrow="kb / documents / search"
        title="Search"
        description="Find passages across all documents."
      />
      <search className="mb-6 block max-w-2xl">
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="search-q" className="sr-only">
              Search documents
            </label>
            <Input
              id="search-q"
              type="search"
              placeholder="Search documents"
              value={value}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => setValue(e.target.value)}
            />
            {error && (
              <p id={errorId} className="mt-1 text-sm text-danger">
                {error}
              </p>
            )}
          </div>
          <Button type="submit">Search</Button>
        </form>
      </search>
      {q && (
        <LoadState state={state} label="Searching…" skeleton={<SkeletonRows />}>
          {(found) => (
            <div>
              <p role="status" className="mb-2 text-sm text-fg-muted">
                {found.length
                  ? `${found.length} result${found.length === 1 ? "" : "s"} for "${q}"`
                  : `No passages match "${q}". Try other words.`}
              </p>
              {found.length > 0 && (
                <ul className="divide-y divide-dotted divide-border rounded-card border border-border bg-surface">
                  {found.map(({ doc, chunk, score }) => (
                    <li key={`${doc.id}-${chunk.index}`} className="px-4 py-3">
                      <Link
                        to={`../documents/${doc.id}#chunk-${chunk.index}`}
                        relative="path"
                        className="font-medium hover:underline"
                      >
                        {doc.title}, chunk {chunk.index}
                      </Link>
                      <span className="ml-2 text-xs text-fg-muted">
                        relevance {score.toFixed(2)}
                      </span>
                      <p className="mt-1 line-clamp-2 text-sm">{chunk.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </LoadState>
      )}
    </div>
  );
}
