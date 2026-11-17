import {
  Access,
  type Document,
  DocumentService,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { toast, useClient, useMutation, useQueryClient } from "@knowcel/module-sdk";
import {
  type AccessChoice,
  AccessPicker,
  Button,
  Dialog,
  ErrorMessage,
  isValidAccess,
  type TeamOption,
} from "@knowcel/ui";
import { useRef, useState } from "react";
import { shareError } from "./errors.ts";
import { useMyTeams } from "./useMyTeams.ts";

/**
 * The "Change access" button and dialog for the owner of a document: public, or
 * the teams of the owner. Anyone else uses ShareEditor.
 */
export function AccessEditor({ document: d }: { document: Document }) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const { teams } = useMyTeams();
  const [choice, setChoice] = useState<AccessChoice | null>(null);
  // Widening a team document to everyone needs a second, explicit click.
  const [confirmingPublic, setConfirmingPublic] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);

  // The user's teams, and those the document has that they are no longer in,
  // which stay unless the owner unticks them.
  const options: TeamOption[] = [
    ...teams.map((t) => ({ id: t.id, name: t.name })),
    ...d.teamIds
      .filter((id) => !teams.some((t) => t.id === id))
      .map((id) => ({ id, name: "Another team" })),
  ];

  const close = () => {
    setChoice(null);
    setConfirmingPublic(false);
    changeButton.current?.focus();
  };
  const widens = d.access === Access.TEAM && choice !== null && !choice.team;
  const save = useMutation({
    mutationFn: (c: AccessChoice) =>
      client.setDocumentAccess({
        id: d.id,
        access: c.team ? Access.TEAM : Access.PUBLIC,
        teamIds: c.team ? c.teamIds : [],
      }),
    onSuccess: async () => {
      toast.success("Access saved");
      setChoice(null);
      setConfirmingPublic(false);
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      changeButton.current?.focus();
    },
  });

  return (
    <>
      <Button
        ref={changeButton}
        variant="secondary"
        onClick={() => {
          save.reset();
          setConfirmingPublic(false);
          setChoice({ team: d.access === Access.TEAM, teamIds: d.teamIds });
        }}
      >
        Change access
      </Button>
      <Dialog
        open={choice !== null}
        onClose={close}
        title="Change access"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!choice) return;
                if (widens && !confirmingPublic) setConfirmingPublic(true);
                else save.mutate(choice);
              }}
              disabled={save.isPending || !choice || !isValidAccess(choice)}
            >
              {widens && confirmingPublic ? "Make public" : "Save access"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <AccessPicker
            legend="Who can read this?"
            teams={options}
            value={choice ?? { team: false, teamIds: [] }}
            onChange={(c) => {
              setConfirmingPublic(false);
              setChoice(c);
            }}
          />
          {widens && confirmingPublic && (
            <p role="alert" className="text-sm">
              Make this document public? Every signed-in user will be able to read it, not just your
              teams.
            </p>
          )}
          {choice?.team && choice.teamIds.length === 0 && (
            <p className="text-xs text-fg-muted">Choose at least one team.</p>
          )}
          <p className="text-xs text-fg-muted">
            Only you can change or delete the document, whoever can read it.
          </p>
          <ErrorMessage error={shareError(save.error)} />
        </div>
      </Dialog>
    </>
  );
}
