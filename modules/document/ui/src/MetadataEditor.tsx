import { DocumentService } from "@kb/document-api/kb/document/v1/document_pb";
import { ConnectError, toast, useClient, useMutation, useQueryClient } from "@kb/module-sdk";
import { Button, Dialog, ErrorMessage, fieldViolations, Input } from "@kb/ui";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Row {
  /** Stable React key; rows have no identity of their own. */
  id: number;
  key: string;
  value: string;
}

let nextRowId = 0;
const row = (key = "", value = ""): Row => ({ id: nextRowId++, key, value });

/** Problems per row id; rows that are entirely empty are dropped instead. */
export function validate(rows: Row[]): Map<number, string> {
  const errors = new Map<number, string>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.key.trim();
    if (!key && !r.value.trim()) continue;
    if (!key) errors.set(r.id, "Key must not be empty");
    else if (seen.has(key)) errors.set(r.id, `Key "${key}" is used twice`);
    seen.add(key);
  }
  return errors;
}

/** The metadata of a document, with a dialog to edit it. */
export function MetadataEditor({ id, metadata }: { id: string; metadata: Record<string, string> }) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [focusRow, setFocusRow] = useState<number | "add" | null>(null);
  const keyInputs = useRef(new Map<number, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const entries = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));

  // Focus moves after the rows have rendered: to a new or next row, or to "Add field".
  useEffect(() => {
    if (focusRow === null) return;
    if (focusRow === "add") addButton.current?.focus();
    else keyInputs.current.get(focusRow)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  const open = () => {
    setErrors(new Map());
    setRows([...entries.map(([k, v]) => row(k, v)), row()]);
  };
  const close = () => {
    setRows(null);
    editButton.current?.focus();
  };
  const update = (rowId: number, change: Partial<Row>) =>
    setRows((rs) => rs?.map((r) => (r.id === rowId ? { ...r, ...change } : r)) ?? null);

  const save = useMutation({
    mutationFn: (values: Record<string, string>) =>
      client.updateDocument({ id, metadata: values, setMetadata: true }),
    onSuccess: () => {
      toast.success("Metadata saved");
      close();
      return queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const submit = () => {
    if (!rows) return;
    const found = validate(rows);
    setErrors(found);
    const firstInvalid = rows.find((r) => found.has(r.id));
    if (firstInvalid) {
      setFocusRow(firstInvalid.id);
      return;
    }
    const values: Record<string, string> = {};
    for (const r of rows) if (r.key.trim()) values[r.key.trim()] = r.value;
    save.mutate(values);
  };

  return (
    <>
      {entries.length > 0 ? (
        <dl className="space-y-0.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="font-mono text-xs text-fg-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span className="text-fg-muted">None</span>
      )}
      <Button ref={editButton} variant="ghost" className="mt-1 -ml-3" onClick={open}>
        Edit metadata
      </Button>
      <Dialog
        open={rows !== null}
        onClose={close}
        title="Edit metadata"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {rows?.map((r, i) => {
            const error = errors.get(r.id);
            const errorId = `metadata-error-${r.id}`;
            return (
              <fieldset key={r.id}>
                <legend className="sr-only">Field {i + 1}</legend>
                <div className="flex items-center gap-2">
                  <Input
                    ref={(el) => {
                      if (el) keyInputs.current.set(r.id, el);
                      else keyInputs.current.delete(r.id);
                    }}
                    aria-label="Key"
                    placeholder="Key"
                    value={r.key}
                    aria-invalid={error !== undefined}
                    aria-describedby={error ? errorId : undefined}
                    onChange={(e) => update(r.id, { key: e.target.value })}
                  />
                  <Input
                    aria-label="Value"
                    placeholder="Value"
                    value={r.value}
                    onChange={(e) => update(r.id, { value: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${r.key.trim() || `field ${i + 1}`}`}
                    onClick={() => {
                      const next = rows[i + 1] ?? null;
                      setRows(rows.filter((x) => x.id !== r.id));
                      setFocusRow(next ? next.id : "add");
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                {error && (
                  <p id={errorId} className="mt-1 text-xs text-danger">
                    {error}
                  </p>
                )}
              </fieldset>
            );
          })}
          <Button
            ref={addButton}
            variant="ghost"
            className="-ml-3"
            onClick={() => {
              const added = row();
              setRows([...(rows ?? []), added]);
              setFocusRow(added.id);
            }}
          >
            <Plus className="size-4" aria-hidden="true" /> Add field
          </Button>
          <ErrorMessage
            error={
              // Field violations as a list; any other error by its message, without the code.
              save.error && fieldViolations(save.error).length === 0
                ? ConnectError.from(save.error).rawMessage
                : save.error
            }
          />
        </div>
      </Dialog>
    </>
  );
}
