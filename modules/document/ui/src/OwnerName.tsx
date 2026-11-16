import { IamService, type TeamMember } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import { useClient, useQuery } from "@knowcel/module-sdk";

/**
 * Who owns a document someone else uploaded. IAM has no user lookup for ordinary
 * users, so the name comes from the members of the teams the document is shared
 * with that the user is in; without a match, or while IAM is down, it is "Another user".
 */
export function OwnerName({ ownerId, teamIds }: { ownerId: string; teamIds: string[] }) {
  const client = useClient(IamService);
  const owner = useQuery({
    queryKey: ["documents", "owner", ownerId, teamIds],
    queryFn: async (): Promise<TeamMember | undefined> => {
      for (const id of teamIds) {
        const { team } = await client.getTeam({ id }).catch(() => ({ team: undefined }));
        const member = team?.members.find((m) => m.userId === ownerId);
        if (member) return member;
      }
      return undefined;
    },
    enabled: teamIds.length > 0,
    retry: false,
  });
  const m = owner.data;
  return <>{m ? m.displayName || m.email : "Another user"}</>;
}
