import { Badge } from "@knowcel/ui";
import { useMyTeams } from "./useMyTeams.ts";

/**
 * The teams a document is shared with, as badges. Names come from IAM; without
 * them (IAM unavailable, or a team the user isn't in) the badge doesn't name
 * the team.
 */
export function SharedWith({ teamIds }: { teamIds: string[] }) {
  const { teams, known } = useMyTeams();
  if (teamIds.length === 0) return null;
  const labels = known
    ? teamIds.map((id) => ({ id, name: teams.find((t) => t.id === id)?.name ?? "Another team" }))
    : [{ id: "shared", name: "Shared" }];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="sr-only">Shared with</span>
      {labels.map(({ id, name }) => (
        <Badge key={id} tone="info">
          {name}
        </Badge>
      ))}
    </span>
  );
}
