import { IamService, type Team } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import { useClient, useQuery } from "@knowcel/module-sdk";

/**
 * The teams of the signed-in user. IAM is a soft dependency: while it is
 * unavailable there are no teams and no error, and `known` is false.
 */
export function useMyTeams(): { teams: Team[]; known: boolean } {
  const client = useClient(IamService);
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: () => client.listMyTeams({}),
    retry: false,
  });
  return { teams: teams.data?.teams ?? [], known: teams.isSuccess };
}
