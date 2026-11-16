import { Access } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { Badge } from "@knowcel/ui";
import { useMyTeams } from "./useMyTeams.ts";

/**
 * Who can read a document, as badges: "Public", or its teams. Names come from
 * IAM; without them (IAM unavailable, or a team the user isn't in) the badge
 * doesn't name the team.
 */
export function SharedWith({ access, teamIds }: { access: Access; teamIds: string[] }) {
  const { teams, known } = useMyTeams();
  if (access === Access.PUBLIC) {
    return (
      <Badge tone="neutral">
        <span className="sr-only">Access: </span>Public
      </Badge>
    );
  }
  const labels =
    known && teamIds.length > 0
      ? teamIds.map((id) => ({ id, name: teams.find((t) => t.id === id)?.name ?? "Another team" }))
      : [{ id: "team", name: "Team" }];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="sr-only">Access: team</span>
      {labels.map(({ id, name }) => (
        <Badge key={id} tone="info">
          {name}
        </Badge>
      ))}
    </span>
  );
}
