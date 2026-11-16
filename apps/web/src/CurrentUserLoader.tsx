import { IamService } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  type CurrentUser,
  CurrentUserProvider,
  type CurrentUserStatus,
  useClient,
  useQuery,
} from "@knowcel/module-sdk";
import { type ReactNode, useMemo } from "react";
import { useSession } from "./auth/AuthGate.tsx";

/**
 * Registers the signed-in user with the user registry (the IAM module) and
 * hands them to `useCurrentUser`. The call happens once per session, not per
 * page: the result stays cached for as long as the page lives. The app renders
 * meanwhile, and without a user when the registry is unavailable, so a down
 * IAM only hides what needs it.
 */
export function CurrentUserLoader({ children }: { children: ReactNode }) {
  const client = useClient(IamService);
  const session = useSession();
  const who = session?.email ?? session?.name;
  const { data, status } = useQuery({
    // Keyed by who is signed in, so another user never sees this user's entry.
    queryKey: ["current-user", who],
    queryFn: async () => (await client.getCurrentUser({})).user,
    enabled: who !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const user = useMemo<CurrentUser | null>(
    () =>
      data
        ? {
            id: data.id,
            email: data.email,
            displayName: data.displayName,
            platformAdmin: data.platformAdmin,
          }
        : null,
    [data],
  );
  // Without a sign-in the query never runs: no user is expected then.
  const state: CurrentUserStatus =
    who === undefined
      ? "ready"
      : status === "pending"
        ? "loading"
        : status === "error"
          ? "failed"
          : "ready";
  return (
    <CurrentUserProvider user={user} status={state}>
      {children}
    </CurrentUserProvider>
  );
}
