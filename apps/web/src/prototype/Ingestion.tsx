import { Badge, Button, Card, EmptyState, PageHeader } from "@kb/ui";
import { Upload as UploadIcon, X } from "lucide-react";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { newId, useStore } from "./store.tsx";
import { LoadState, MenuButton, SkeletonRows, Time, useAnnouncer, useMockQuery } from "./ui.tsx";

// Upload flow from docs/ux/m1/ingestion.md. Filenames steer the simulation:
// "fail" breaks the upload at 60 %, "broken" or "scan" fails processing, and
// anything but PDF, Markdown or text is rejected before upload.

type UploadState =
  | "waiting"
  | "uploading"
  | "rejected"
  | "upload-failed"
  | "queued"
  | "processing"
  | "failed"
  | "done";

interface Row {
  id: string;
  filename: string;
  sizeBytes: number;
  state: UploadState;
  progress: number;
  error?: string;
  documentId?: string;
  chunkCount?: number;
  created: Date;
}

const SUPPORTED = /\.(pdf|md|markdown|txt)$/i;
const PARALLEL = 3;

const initialRows: Row[] = [
  {
    id: "u1",
    filename: "quarterly-report-q3.pdf",
    sizeBytes: 1_250_000,
    state: "done",
    progress: 100,
    documentId: "d1",
    chunkCount: 42,
    created: new Date(Date.now() - 2 * 60_000),
  },
  {
    id: "u2",
    filename: "broken-scan.pdf",
    sizeBytes: 3_400_000,
    state: "failed",
    progress: 100,
    error: "No text found. The PDF may be a scan without a text layer.",
    documentId: "d4",
    created: new Date(Date.now() - 26 * 3_600_000),
  },
];

export function Ingestion() {
  const { addDoc, updateDoc } = useStore();
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLButtonElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const [announcer, announce] = useAnnouncer();
  const state = useMockQuery(rows, [], "The ingestion service");

  const update = useCallback(
    (id: string, patch: Partial<Row>) =>
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    [],
  );

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) {
        clearInterval(t);
      }
    };
  }, []);

  const process = useCallback(
    (row: Row) => {
      update(row.id, { state: "queued", progress: 100, error: undefined });
      announce(`${row.filename} uploaded, processing`);
      setTimeout(() => update(row.id, { state: "processing" }), 800);
      setTimeout(() => {
        if (/broken|scan/i.test(row.filename)) {
          const error = "No text found. The PDF may be a scan without a text layer.";
          update(row.id, { state: "failed", error });
          announce(`Processing ${row.filename} failed: ${error}`);
          return;
        }
        const documentId = row.documentId ?? newId("d");
        const chunkCount = 5 + (row.filename.length % 20);
        if (row.documentId) {
          updateDoc(documentId, { status: "ready", error: undefined });
        } else {
          addDoc({
            id: documentId,
            title: row.filename.replace(/\.[^.]+$/, ""),
            filename: row.filename,
            status: "ready",
            sizeBytes: row.sizeBytes,
            contentType: row.filename.endsWith(".pdf") ? "application/pdf" : "text/markdown",
            added: new Date(),
            metadata: [],
            chunks: Array.from({ length: chunkCount }, (_, i) => ({
              index: i + 1,
              page: i + 1,
              text: `Mock text of ${row.filename}, part ${i + 1}. Uploaded in the prototype.`,
            })),
          });
        }
        update(row.id, { state: "done", documentId, chunkCount });
        announce(`${row.filename} is ready`);
      }, 2500);
    },
    [update, announce, addDoc, updateDoc],
  );

  const startUpload = useCallback(
    (row: Row) => {
      update(row.id, { state: "uploading", progress: 0, error: undefined });
      let progress = 0;
      const timer = setInterval(() => {
        progress += 10;
        // A retry (started from the upload-failed state) always succeeds.
        if (/fail/i.test(row.filename) && progress >= 60 && row.state !== "upload-failed") {
          clearInterval(timer);
          timers.current.delete(row.id);
          update(row.id, { state: "upload-failed", progress, error: "connection lost" });
          announce(`Upload of ${row.filename} failed`);
          return;
        }
        if (progress >= 100) {
          clearInterval(timer);
          timers.current.delete(row.id);
          process(row);
          return;
        }
        update(row.id, { progress });
      }, 250);
      timers.current.set(row.id, timer);
    },
    [update, announce, process],
  );

  // Starts waiting uploads while fewer than PARALLEL are running.
  useEffect(() => {
    const running = rows.filter((r) => r.state === "uploading").length;
    const next = rows.filter((r) => r.state === "waiting").slice(0, PARALLEL - running);
    for (const r of next) {
      startUpload(r);
    }
  }, [rows, startUpload]);

  const addFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) {
      return;
    }
    const added: Row[] = list.map((f) => ({
      id: newId("u"),
      filename: f.name,
      sizeBytes: f.size,
      state: SUPPORTED.test(f.name) ? "waiting" : "rejected",
      progress: 0,
      error: SUPPORTED.test(f.name) ? undefined : "Not supported (PDF, Markdown or text)",
      created: new Date(),
    }));
    setRows((rs) => [...added, ...rs]);
    const ok = added.filter((r) => r.state === "waiting").length;
    const rejected = added.filter((r) => r.state === "rejected");
    announce(
      [
        ok ? `Uploading ${ok} file${ok === 1 ? "" : "s"}` : "",
        ...rejected.map((r) => `${r.filename} isn't supported. Use PDF, Markdown or text.`),
      ]
        .filter(Boolean)
        .join(". "),
    );
  };

  const remove = (row: Row, index: number) => {
    const timer = timers.current.get(row.id);
    if (timer) {
      clearInterval(timer);
      timers.current.delete(row.id);
    }
    setRows((rs) => rs.filter((r) => r.id !== row.id));
    // Focus the next row's first control, or the file chooser.
    setTimeout(() => {
      const next = document.querySelectorAll<HTMLElement>("[data-upload-row] :is(a,button)")[index];
      (next ?? chooser.current)?.focus();
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div>
      <PageHeader
        title="Ingestion"
        description="Upload documents to add them to the knowledge base."
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag and drop is a pointer shortcut; keyboard users use the Choose files button. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: same reason. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mb-6 flex flex-col items-center gap-2 rounded-card border-2 border-dashed p-8 text-center text-sm text-fg-muted ${dragging ? "border-border-strong bg-surface-muted" : "border-border-strong bg-surface"}`}
      >
        <UploadIcon className="size-6" aria-hidden="true" />
        {dragging ? (
          <span>Drop to upload</span>
        ) : (
          <span>
            Drop files here or{" "}
            <Button ref={chooser} variant="secondary" onClick={() => input.current?.click()}>
              Choose files
            </Button>
          </span>
        )}
        <span>PDF, Markdown or plain text</span>
        <span className="text-xs">
          Try it: a name with "fail" breaks the upload, "scan" fails processing, .pptx is rejected.
        </span>
        <input
          ref={input}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <h2 className="mb-2 text-lg font-semibold">Uploads</h2>
      <Card>
        <LoadState state={state} label="Loading uploads" skeleton={<SkeletonRows />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>No uploads yet. Drop files above to add documents.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {list.map((r, i) => (
                  <UploadRow
                    key={r.id}
                    row={r}
                    onRetryUpload={() => startUpload({ ...r, state: "upload-failed" })}
                    onRetryProcessing={() => process(r)}
                    onRemove={() => remove(r, i)}
                  />
                ))}
              </ul>
            )
          }
        </LoadState>
      </Card>
      {announcer}
    </div>
  );
}

function UploadRow({
  row,
  onRetryUpload,
  onRetryProcessing,
  onRemove,
}: {
  row: Row;
  onRetryUpload: () => void;
  onRetryProcessing: () => void;
  onRemove: () => void;
}) {
  const name =
    row.state === "done" && row.documentId ? (
      <Link to={`../documents/${row.documentId}`} relative="path" className="font-medium underline">
        {row.filename}
      </Link>
    ) : (
      <span className="font-medium">{row.filename}</span>
    );
  const removable = ["waiting", "uploading", "rejected", "upload-failed"].includes(row.state);
  return (
    <li data-upload-row className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {row.state === "waiting" && <span className="text-fg-muted">Waiting</span>}
      {row.state === "uploading" && (
        <span className="flex items-center gap-2">
          <progress
            max={100}
            value={row.progress}
            aria-label={`Uploading ${row.filename}`}
            className="h-2 w-32 accent-accent"
          />
          <span className="w-10 text-right text-fg-muted">{row.progress} %</span>
        </span>
      )}
      {row.state === "rejected" && <span className="text-danger">⚠ {row.error}</span>}
      {row.state === "upload-failed" && (
        <>
          <span className="text-danger">⚠ Upload failed: {row.error}</span>
          <Button variant="secondary" onClick={onRetryUpload}>
            Retry upload
          </Button>
        </>
      )}
      {row.state === "queued" && <Badge tone="info">Queued</Badge>}
      {row.state === "processing" && <Badge tone="warning">Processing</Badge>}
      {row.state === "failed" && (
        <>
          <Badge tone="danger">Failed</Badge>
          <span className="text-danger">{row.error}</span>
          <Button variant="secondary" onClick={onRetryProcessing}>
            Retry processing
          </Button>
        </>
      )}
      {row.state === "done" && (
        <>
          <Badge tone="success">Done</Badge>
          <span className="text-fg-muted">{row.chunkCount} chunks</span>
          <span className="text-fg-muted">
            <Time date={row.created} />
          </span>
          <MenuButton
            label={`Actions for ${row.filename}`}
            items={[{ label: "Reprocess", onSelect: onRetryProcessing }]}
          />
        </>
      )}
      {removable && (
        <button
          type="button"
          aria-label={
            row.state === "uploading" || row.state === "waiting"
              ? `Cancel upload of ${row.filename}`
              : `Dismiss ${row.filename}`
          }
          onClick={onRemove}
          className="inline-flex size-7 items-center justify-center rounded-control text-fg-muted hover:bg-surface-muted"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
