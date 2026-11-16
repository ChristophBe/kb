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
import { SharedWith } from "./SharedWith.tsx";
import { useMyTeams } from "./useMyTeams.ts";

/**
 * Who can read a document, and a dialog for its owner to change that: public,
 * or the teams of the owner. Anyone else uses ShareEditor.
 */
export function AccessEditor({ document: d }: { document: Document }) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const { teams } = useMyTeams();
  const [choice, setChoice] = useState<AccessChoice | null>(null);
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
    changeButton.current?.focus();
  };
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
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      changeButton.current?.focus();
    },
  });

  return (
    <>
      <SharedWith access={d.access} teamIds={d.teamIds} />
      <Button
        ref={changeButton}
        variant="ghost"
        className="mt-1 -ml-3 block"
        onClick={() => {
          save.reset();
          setChoice({ team: d.access === Access.TEAM, teamIds: d.teamIds });
        }}
      >
        Change access
      </Button>
      <Dialog
        open={choice !== null}
        onClose={close}
        title="Who can read this document?"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => choice && save.mutate(choice)}
              disabled={save.isPending || !choice || !isValidAccess(choice)}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <AccessPicker
            legend="Access"
            teams={options}
            value={choice ?? { team: false, teamIds: [] }}
            onChange={setChoice}
          />
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
