import { IamService } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import { useClient, useQuery } from "@knowcel/module-sdk";

/**
 * Names for user ids, from the members of the teams the signed-in user is in:
 * IAM has no user lookup for ordinary users. Someone who shares no team with
 * them is not in the map.
 */
export function useUserNames(): ReadonlyMap<string, string> {
  const client = useClient(IamService);
  const names = useQuery({
    queryKey: ["lifecycle", "user-names"],
    queryFn: async () => {
      const found = new Map<string, string>();
      const { teams } = await client.listMyTeams({});
      for (const t of teams) {
        const { team } = await client.getTeam({ id: t.id });
        for (const m of team?.members ?? []) found.set(m.userId, m.displayName || m.email);
      }
      return found;
    },
    retry: false,
    staleTime: 60_000,
  });
  return names.data ?? new Map();
}
