import {
  type Document,
  DocumentService,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import { toast, useClient, useCurrentUser, useMutation, useQueryClient } from "@knowcel/module-sdk";
import { Button, Dialog, ErrorMessage, type TeamOption, TeamPicker } from "@knowcel/ui";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { shareError } from "./errors.ts";
import { SharedWith } from "./SharedWith.tsx";
import { useMyTeams } from "./useMyTeams.ts";

/**
 * The teams a document is shared with, and a dialog to change them: the owner
 * picks among their teams; a team admin can only stop sharing with their team.
 */
export function ShareEditor({ document: d }: { document: Document }) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { teams, known } = useMyTeams();
  const [selected, setSelected] = useState<string[] | null>(null);
  const shareButton = useRef<HTMLButtonElement>(null);

  const isOwner = user !== null && d.ownerId === user.id;
  // The owner can add any of their teams; anyone else sees only the teams they are in.
  const ids = isOwner ? [...new Set([...teams.map((t) => t.id), ...d.teamIds])] : d.teamIds;
  const options: TeamOption[] = ids.map((id) => {
    const team = teams.find((t) => t.id === id);
    return {
      id,
      name: team?.name ?? "Another team",
      disabled: !isOwner && team?.myRole !== TeamRole.ADMIN,
    };
  });
  const canChange = known && options.some((o) => !o.disabled);

  const close = () => {
    setSelected(null);
    shareButton.current?.focus();
  };
  const save = useMutation({
    mutationFn: (teamIds: string[]) => client.setDocumentTeams({ id: d.id, teamIds }),
    onSuccess: async ({ document: updated }) => {
      toast.success("Sharing saved");
      setSelected(null);
      // A team admin who stopped sharing with their team can no longer see the document.
      if (!isOwner && updated?.teamIds.length === 0) {
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
      {d.teamIds.length > 0 ? (
        <SharedWith teamIds={d.teamIds} />
      ) : (
        <span className="text-fg-muted">Not shared</span>
      )}
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
          {isOwner ? "Share" : "Stop sharing"}
        </Button>
      )}
      <Dialog
        open={selected !== null}
        onClose={close}
        title={isOwner ? "Share document" : "Stop sharing with your team"}
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
            hint={
              isOwner
                ? "Members of the chosen teams can find it, read it and ask about it in chat. Only you can change or delete it."
                : "Only the owner can share it with more teams. As a team admin you can stop sharing it with your team."
            }
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
