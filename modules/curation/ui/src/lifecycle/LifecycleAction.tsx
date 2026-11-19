import {
  CurationService,
  type Lifecycle,
  LifecycleState,
} from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { IamService } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  Code,
  ConnectError,
  toast,
  useClient,
  useCurrentUser,
  useMutation,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import { Button, Dialog, ErrorMessage, Input, Textarea } from "@knowcel/ui";
import { useId, useRef, useState } from "react";
import { findingsError } from "../errors.ts";
import { useReturnFocus } from "../focus.ts";
import LifecycleBadge from "./LifecycleBadge.tsx";
import { mayChange } from "./permission.ts";
import { leavesChat, STATES, stateInfo } from "./states.ts";
import { useDocumentState } from "./useLifecycle.ts";

const MAX_NOTE = 1000;
const WHO_MAY = "Only the owner, a team admin or a platform admin can change the approval state.";

/** What a failed save means for the user. */
function saveError(err: unknown): Error | null {
  if (ConnectError.from(err).code === Code.PermissionDenied) return new Error(WHO_MAY);
  if (ConnectError.from(err).code === Code.NotFound) {
    return new Error("This document is no longer available.");
  }
  return findingsError(err);
}

/** "2026-12-01" from a protobuf timestamp, as a date field takes it. */
function dateValue(ts: Lifecycle["reviewBy"]): string {
  return ts ? new Date(Number(ts.seconds) * 1000).toISOString().slice(0, 10) : "";
}

/**
 * The approval state of a document in the toolbar of its page: the badge, and a
 * button that opens the dialog to change it. The button is disabled for people
 * who may not change the state.
 */
export default function LifecycleAction({ documentId }: { documentId: string }) {
  const documents = useClient(DocumentService);
  const iam = useClient(IamService);
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hint = useId();
  useReturnFocus(open, button);
  const state = useDocumentState(documentId);
  const document = useQuery({
    queryKey: ["lifecycle", "document", documentId],
    queryFn: () => documents.getDocument({ id: documentId }),
    retry: false,
  });
  const teams = useQuery({
    queryKey: ["lifecycle", "my-teams"],
    queryFn: () => iam.listMyTeams({}),
    retry: false,
  });
  // Not known while loading or when a service can't be asked: the service decides.
  const allowed = document.data?.document
    ? mayChange(user, document.data.document, teams.data?.teams)
    : true;
  // The dialog starts from the current state, so it waits for it (and for who may change it).
  const loading = state.isPending || document.isPending || (teams.isPending && !!user);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <LifecycleBadge documentId={documentId} />
      <Button
        ref={button}
        variant="secondary"
        disabled={!allowed || loading}
        aria-describedby={allowed ? undefined : hint}
        title={allowed ? undefined : WHO_MAY}
        onClick={() => setOpen(true)}
      >
        Approval state
      </Button>
      {!allowed && (
        <span id={hint} className="sr-only">
          {WHO_MAY}
        </span>
      )}
      <StateDialog
        documentId={documentId}
        current={state.data?.lifecycle}
        open={open}
        onClose={() => setOpen(false)}
      />
    </span>
  );
}

/** The dialog is only there while open, so the form starts from the current state each time. */
function StateDialog(props: {
  documentId: string;
  current: Lifecycle | undefined;
  open: boolean;
  onClose: () => void;
}) {
  return props.open ? <OpenStateDialog {...props} /> : null;
}

function OpenStateDialog({
  documentId,
  current,
  onClose,
}: {
  documentId: string;
  current: Lifecycle | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const client = useClient(CurationService);
  const queryClient = useQueryClient();
  const name = useId();
  const formId = useId();
  const reviewId = useId();
  const noteId = useId();
  const [state, setState] = useState<LifecycleState>(current?.state ?? LifecycleState.UNSPECIFIED);
  const [reviewBy, setReviewBy] = useState(dateValue(current?.reviewBy));
  const [note, setNote] = useState("");
  const info = stateInfo(state);
  const removes = leavesChat(state);

  const save = useMutation({
    mutationFn: () =>
      client.setLifecycle({
        documentId,
        state,
        note: note.trim(),
        reviewBy: reviewBy
          ? { seconds: BigInt(Math.floor(Date.parse(`${reviewBy}T00:00:00Z`) / 1000)), nanos: 0 }
          : undefined,
      }),
    onSuccess: async () => {
      toast.success(`Approval state: ${info?.label ?? "saved"}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lifecycle", "state"] }),
        queryClient.invalidateQueries({ queryKey: ["lifecycle", "history"] }),
        queryClient.invalidateQueries({ queryKey: ["findings"] }),
        queryClient.invalidateQueries({ queryKey: ["finding-scores"] }),
      ]);
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Approval state"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={removes ? "danger" : "primary"}
            disabled={!info || save.isPending}
          >
            {state === LifecycleState.DEPRECATED
              ? "Deprecate document"
              : state === LifecycleState.ARCHIVED
                ? "Archive document"
                : "Save"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (info) save.mutate();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">State</legend>
          {STATES.map(({ state: value, info: i }) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={name}
                className="mt-0.5 size-4 accent-accent"
                checked={state === value}
                onChange={() => setState(value)}
              />
              <span>
                {i.label}
                <span className="block text-xs text-fg-muted">{i.meaning}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {removes && (
          <p
            role="note"
            className="rounded-control bg-warning-subtle px-3 py-2 text-sm text-warning"
          >
            Chat stops using this document in its answers and sources. It stays in your documents
            and in search, and you can change its state again.
          </p>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={reviewId} className="font-medium">
            Review by (optional)
          </label>
          <Input
            id={reviewId}
            type="date"
            value={reviewBy}
            aria-describedby={`${reviewId}-hint`}
            onChange={(e) => setReviewBy(e.target.value)}
          />
          <span id={`${reviewId}-hint`} className="text-xs text-fg-muted">
            From this day the document shows up under Document checks as due for review.
          </span>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={noteId} className="font-medium">
            Note (optional)
          </label>
          <Textarea
            id={noteId}
            rows={3}
            maxLength={MAX_NOTE}
            value={note}
            aria-describedby={`${noteId}-hint`}
            onChange={(e) => setNote(e.target.value)}
          />
          <span id={`${noteId}-hint`} className="text-xs text-fg-muted">
            Shown in the document's approval history.
          </span>
        </div>
        <ErrorMessage error={saveError(save.error)} />
      </form>
    </Dialog>
  );
}
