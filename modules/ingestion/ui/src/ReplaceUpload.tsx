import { IngestionService } from "@kb/ingestion-api/kb/ingestion/v1/ingestion_pb";
import { toast, useClient } from "@kb/module-sdk";
import { Button, fieldViolations, PageHeader } from "@kb/ui";
import { AlertTriangle, Upload as UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { isSupported, SUPPORTED_FORMATS, sha256 } from "./files.ts";
import { putWithProgress } from "./put.ts";
import { describe } from "./useUploads.ts";

type State =
  | { step: "choose"; error?: string }
  | { step: "uploading"; filename: string; progress: number };

/**
 * Uploads a new version of an existing document. The document keeps its id, title and
 * metadata; once the file is up, the document page shows the new version being processed.
 */
export function ReplaceUpload() {
  const { documentId = "" } = useParams();
  // The document page passes its title along; opened directly, the page does without.
  const title = (useLocation().state as { title?: string } | null)?.title;
  const client = useClient(IngestionService);
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ step: "choose" });
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const documentPath = `/m/document/${documentId}`;

  useEffect(() => () => controller.current?.abort(), []);

  // Back on the chooser after a failure, focus goes to the button that tries again.
  useEffect(() => {
    if (state.step === "choose" && state.error) chooseButton.current?.focus();
  }, [state]);

  const upload = async (file: File) => {
    if (!isSupported(file)) {
      setState({
        step: "choose",
        error: `${file.name} isn't supported. Use ${SUPPORTED_FORMATS}.`,
      });
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setState({ step: "uploading", filename: file.name, progress: 0 });
    try {
      const replaced = await client.replaceUpload({
        documentId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: BigInt(file.size),
        sha256: await sha256(file),
      });
      abort.signal.throwIfAborted();
      // The server may name a better type than the browser's (e.g. for .md).
      const contentType = replaced.job?.contentType || file.type || "application/octet-stream";
      await putWithProgress(
        replaced.uploadUrl,
        file,
        contentType,
        (progress) => setState({ step: "uploading", filename: file.name, progress }),
        abort.signal,
      );
      abort.signal.throwIfAborted();
      await client.completeUpload({ jobId: replaced.job?.id ?? "" });
      toast.success(`${file.name} uploaded, processing the new version`);
      navigate(documentPath);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const violations = fieldViolations(err);
      const reason =
        violations.length > 0 ? violations.map((v) => v.description).join(". ") : describe(err);
      setState({ step: "choose", error: `${file.name} wasn't uploaded: ${reason}` });
    } finally {
      controller.current = null;
    }
  };

  return (
    <div>
      <Link to={documentPath} className="text-sm text-fg-muted hover:underline">
        ← Back to the document
      </Link>
      <PageHeader
        eyebrow="kb / ingestion"
        title="Upload new version"
        description={`Choose the new file${title ? ` for “${title}”` : ""}. The document keeps its title, metadata and links in chats, and stays readable with its current file until the new one is ready.`}
      />
      <div className="mb-6 flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-border-strong bg-surface p-10 text-sm text-fg-muted">
        <UploadIcon className="size-6" aria-hidden="true" />
        {state.step === "uploading" ? (
          <>
            <span className="flex items-center gap-2">
              <progress
                max={100}
                value={Math.round(state.progress * 100)}
                aria-label={`Uploading ${state.filename}`}
                className="h-1.5 w-40 accent-fg"
              />
              <span className="w-10 text-right font-mono tabular-nums">
                {Math.round(state.progress * 100)} %
              </span>
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                controller.current?.abort();
                setState({ step: "choose" });
              }}
            >
              Cancel upload
            </Button>
          </>
        ) : (
          <Button ref={chooseButton} onClick={() => fileInput.current?.click()}>
            Choose file
          </Button>
        )}
        <span>{SUPPORTED_FORMATS}</span>
        <input
          ref={fileInput}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      <p role="status" className="sr-only">
        {state.step === "uploading" ? `Uploading ${state.filename}` : ""}
      </p>
      <div role="alert">
        {state.step === "choose" && state.error && (
          <p className="flex items-center gap-1.5 text-sm text-danger">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            {state.error}
          </p>
        )}
      </div>
    </div>
  );
}
