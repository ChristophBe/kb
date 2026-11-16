import {
  Access,
  type Document,
  DocumentService,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import { toast, useClient, useMutation, useQueryClient } from "@knowcel/module-sdk";
import { Button, Dialog, ErrorMessage, type TeamOption, TeamPicker } from "@knowcel/ui";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { shareError } from "./errors.ts";
import { SharedWith } from "./SharedWith.tsx";
import { useMyTeams } from "./useMyTeams.ts";

/**
 * Who can read a document someone else owns and, for an admin of one of its
 * teams, a dialog to stop sharing it with their team. The owner uses
 * AccessEditor.
 */
export function ShareEditor({ document: d }: { document: Document }) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { teams, known } = useMyTeams();
  const [selected, setSelected] = useState<string[] | null>(null);
  const shareButton = useRef<HTMLButtonElement>(null);

  // Only the teams the user is in are visible, and only those they admin can be changed.
  const options: TeamOption[] = d.teamIds.map((id) => {
    const team = teams.find((t) => t.id === id);
    return {
      id,
      name: team?.name ?? "Another team",
      disabled: team?.myRole !== TeamRole.ADMIN,
    };
  });
  const canChange = d.access === Access.TEAM && known && options.some((o) => !o.disabled);

  const close = () => {
    setSelected(null);
    shareButton.current?.focus();
  };
  const save = useMutation({
    mutationFn: (teamIds: string[]) => client.setDocumentTeams({ id: d.id, teamIds }),
    onSuccess: async ({ document: updated }) => {
      toast.success("Sharing saved");
      setSelected(null);
      // An admin who stopped sharing with their team can no longer see the document.
      if (updated?.teamIds.length === 0) {
        queryClient.removeQueries({ queryKey: ["documents", d.id] });
        await queryClient.invalidateQueries({ queryKey: ["documents"] });
        navigate("..", { relative: "path" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      shareButton.current?.focus();
    },
  });

  return (
    <>
      <SharedWith access={d.access} teamIds={d.teamIds} />
      {canChange && (
        <Button
          ref={shareButton}
          variant="ghost"
          className="mt-1 -ml-3 block"
          onClick={() => {
            save.reset();
            setSelected(d.teamIds);
          }}
        >
          Stop sharing
        </Button>
      )}
      <Dialog
        open={selected !== null}
        onClose={close}
        title="Stop sharing with your team"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => selected && save.mutate(selected)} disabled={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <TeamPicker
            legend="Teams that can read this document"
            hint="Only the owner can share it with more teams. As a team admin you can stop sharing it with your team."
            options={options}
            selected={selected ?? []}
            onChange={setSelected}
          />
          <ErrorMessage error={shareError(save.error)} />
        </div>
      </Dialog>
    </>
  );
}
