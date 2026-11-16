import { Access, type Job } from "@knowcel/ingestion-api/knowcel/ingestion/v1/ingestion_pb";
import {
  type AccessChoice,
  AccessPicker,
  Button,
  fieldError,
  Input,
  isValidAccess,
  PUBLIC_ACCESS,
} from "@knowcel/ui";
import { useId, useState } from "react";
import { describe } from "./useUploads.ts";

/** The RPC of IngestionService that adding a page needs. */
export interface UrlClient {
  createFromUrl(req: { url: string; access: Access; teamIds: string[] }): Promise<{ job?: Job }>;
}

/** Adds a web page as a document: its address and who can read it. */
export function UrlImport({
  client,
  teams,
  onJob,
  announce,
}: {
  client: UrlClient;
  teams: { id: string; name: string }[];
  onJob: (job: Job) => void;
  announce: (message: string, urgent?: boolean) => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const [url, setUrl] = useState("");
  const [choice, setChoice] = useState<AccessChoice>(PUBLIC_ACCESS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await client.createFromUrl({
        url: url.trim(),
        access: choice.team ? Access.TEAM : Access.PUBLIC,
        teamIds: choice.team ? choice.teamIds : [],
      });
      if (created.job) onJob(created.job);
      announce(`${created.job?.filename ?? "The page"} added, processing`);
      setUrl("");
      setChoice(PUBLIC_ACCESS);
    } catch (err) {
      const reason = fieldError(err, "url") ?? describe(err);
      setError(reason);
      announce(`The page wasn't added: ${reason}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mb-6 rounded-card border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && url.trim() !== "" && isValidAccess(choice)) void submit();
      }}
    >
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
        Add a web page
      </label>
      <Input
        id={inputId}
        type="url"
        inputMode="url"
        placeholder="https://example.com/article"
        autoComplete="off"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-invalid={error !== ""}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="mt-3">
        <AccessPicker
          legend="Who can read this page?"
          teams={teams}
          value={choice}
          onChange={setChoice}
        />
      </div>
      {choice.team && choice.teamIds.length === 0 && (
        <p className="mt-2 text-xs text-fg-muted">Choose at least one team.</p>
      )}
      <div className="mt-4">
        {/* aria-disabled, not disabled: focus stays on the button while the page is fetched. */}
        <Button type="submit" aria-disabled={busy || url.trim() === "" || !isValidAccess(choice)}>
          {busy ? "Fetching…" : "Add page"}
        </Button>
      </div>
    </form>
  );
}
