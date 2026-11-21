import {
  CurationService,
  type Report,
  ReportReason,
} from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
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
import { Button, Dialog, ErrorMessage, formatTime, Textarea } from "@knowcel/ui";
import { useId, useRef, useState } from "react";
import { findingsError } from "../errors.ts";
import { useReturnFocus } from "../focus.ts";
import { REASONS, reasonLabel } from "./reasons.ts";

const MAX_COMMENT = 1000;

/** What a failed report means for the user. */
function reportError(err: unknown): Error | null {
  if (ConnectError.from(err).code === Code.NotFound) {
    return new Error("This document is no longer available.");
  }
  return findingsError(err);
}

/**
 * The Report button in the toolbar of a document's page, and the dialog it
 * opens. A user who has reported the document sees their report there instead
 * of a second form, and can change it.
 */
export default function ReportAction({ documentId }: { documentId: string }) {
  const client = useClient(CurationService);
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const reports = useQuery({
    queryKey: ["reports", documentId],
    queryFn: () => client.listReports({ documentId }),
    retry: false,
  });
  // Those who manage the document see every report, so the user's own is picked out.
  const mine = user ? reports.data?.reports.find((r) => r.reporter === user.id) : undefined;
  useReturnFocus(open, button);

  return (
    <>
      <Button
        ref={button}
        variant="secondary"
        // The dialog starts from the user's report, so it waits for it.
        disabled={reports.isPending}
        onClick={() => setOpen(true)}
      >
        {mine ? "Reported" : "Report"}
      </Button>
      {open && (
        <ReportDialog
          documentId={documentId}
          mine={mine}
          unknown={reports.isError}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ReportDialog({
  documentId,
  mine,
  unknown,
  onClose,
}: {
  documentId: string;
  mine: Report | undefined;
  /** Whether the user's earlier report couldn't be loaded. */
  unknown: boolean;
  onClose: () => void;
}) {
  const client = useClient(CurationService);
  const queryClient = useQueryClient();
  const name = useId();
  const formId = useId();
  const commentId = useId();
  // With a report of their own the user first sees it; the form is for changing it.
  const [editing, setEditing] = useState(!mine);
  const [reason, setReason] = useState<ReportReason>(mine?.reason ?? ReportReason.UNSPECIFIED);
  const [comment, setComment] = useState(mine?.comment ?? "");

  const send = useMutation({
    mutationFn: () => client.reportDocument({ documentId, reason, comment: comment.trim() }),
    onSuccess: async () => {
      toast.success(mine ? "Report changed" : "Report sent");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reports", documentId] }),
        queryClient.invalidateQueries({ queryKey: ["findings"] }),
        queryClient.invalidateQueries({ queryKey: ["finding-scores"] }),
      ]);
      onClose();
    },
  });

  const next = (
    <p className="text-fg-muted">
      The document's owner, the admins of its teams and platform admins see your report, and the
      document ranks a little lower until they have looked at it. You can change your report later.
    </p>
  );

  if (!editing && mine) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="You reported this document"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => setEditing(true)}>Change report</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>
            You reported it as <strong>{reasonLabel(mine.reason) ?? "other"}</strong>
            {mine.createdAt && ` on ${formatTime(mine.createdAt)}`}.
          </p>
          {mine.comment && <p className="wrap-anywhere">“{mine.comment}”</p>}
          {next}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Report this document"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={reason === ReportReason.UNSPECIFIED || send.isPending}
          >
            {mine ? "Save report" : "Send report"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason !== ReportReason.UNSPECIFIED) send.mutate();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Reason</legend>
          {REASONS.map((r) => (
            <label key={r.reason} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={name}
                className="mt-0.5 size-4 accent-accent"
                checked={reason === r.reason}
                onChange={() => setReason(r.reason)}
              />
              <span>
                {r.label}
                <span className="block text-xs text-fg-muted">{r.meaning}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={commentId} className="font-medium">
            Comment (optional)
          </label>
          <Textarea
            id={commentId}
            rows={3}
            maxLength={MAX_COMMENT}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        {next}
        {unknown && (
          <p role="note" className="text-fg-muted">
            Your earlier report, if you made one, couldn't be loaded. Sending a report replaces it.
          </p>
        )}
        <ErrorMessage error={reportError(send.error)} />
      </form>
    </Dialog>
  );
}
