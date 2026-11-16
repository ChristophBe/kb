import { IamService, type User } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  toast,
  useClient,
  useCurrentUser,
  useCurrentUserStatus,
  useIsPlatformAdmin,
  useMutation,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DelayedLoading,
  EmptyState,
  ErrorMessage,
  PageHeader,
  SkeletonRows,
  useDocumentTitle,
} from "@knowcel/ui";
import { CircleAlert, ShieldAlert } from "lucide-react";
import { useRef, useState } from "react";
import { userError } from "./errors.ts";

/** The name a user is listed by. */
const userName = (u: User) => u.displayName || u.email || u.id;

/**
 * The user directory, with the platform admin role of each user. Only platform
 * admins see it; the service refuses everyone else as well.
 */
export function Users() {
  useDocumentTitle("Users");
  const isAdmin = useIsPlatformAdmin();
  const status = useCurrentUserStatus();
  return (
    <div>
      <PageHeader
        eyebrow="knowcelium / users"
        title="Users"
        description="Everyone who has signed in to Knowcelium. Platform admins can designate other platform admins."
      />
      {status === "loading" ? (
        <Card>
          <DelayedLoading>
            <SkeletonRows label="Loading your account" />
          </DelayedLoading>
        </Card>
      ) : isAdmin ? (
        <Directory />
      ) : status === "failed" ? (
        <Card>
          <EmptyState icon={CircleAlert}>
            Your account could not be loaded, so some actions, such as the user directory, are
            unavailable. Reload the page to try again.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={ShieldAlert}>Only platform admins can see the users.</EmptyState>
        </Card>
      )}
    </div>
  );
}

function Directory() {
  const client = useClient(IamService);
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const users = useQuery({ queryKey: ["users"], queryFn: () => client.listUsers({}) });
  // The user the demote confirmation asks about.
  const [demoting, setDemoting] = useState<User | null>(null);
  const table = useRef<HTMLTableElement>(null);

  const setAdmin = useMutation({
    mutationFn: (v: { user: User; platformAdmin: boolean }) =>
      client.setPlatformAdmin({ userId: v.user.id, platformAdmin: v.platformAdmin }),
    // Only success closes the dialog: a failure shows its error inside and stays open.
    onSuccess: async (_, { user, platformAdmin }) => {
      setDemoting(null);
      toast.success(
        platformAdmin
          ? `${userName(user)} is now a platform admin`
          : `${userName(user)} is no longer a platform admin`,
      );
      // Demoting yourself ends this page: refresh who you are.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        user.id === me?.id && queryClient.invalidateQueries({ queryKey: ["current-user"] }),
      ]);
    },
  });

  if (users.isPending) {
    return (
      <Card>
        <DelayedLoading>
          <SkeletonRows label="Loading users" />
        </DelayedLoading>
      </Card>
    );
  }
  if (users.error) return <ErrorMessage error={userError(users.error)} />;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {demoting === null && <ErrorMessage error={userError(setAdmin.error)} />}
      <Card className="overflow-x-auto">
        <table ref={table} tabIndex={-1} aria-label="Users" className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-fg-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Role
              </th>
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.data.users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {userName(u)}
                  {u.id === me?.id && <span className="ml-2 text-xs text-fg-muted">(you)</span>}
                </th>
                <td className="px-4 py-2 font-mono text-fg-muted">{u.email}</td>
                <td className="px-4 py-2">
                  {u.platformAdmin ? <Badge tone="info">Platform admin</Badge> : "User"}
                </td>
                <td className="px-2 py-1 text-right whitespace-nowrap">
                  {u.platformAdmin ? (
                    <Button
                      variant="ghost"
                      disabled={setAdmin.isPending}
                      aria-label={`Demote ${userName(u)}`}
                      onClick={() => {
                        setAdmin.reset();
                        setDemoting(u);
                      }}
                    >
                      Demote
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={setAdmin.isPending}
                      aria-label={`Promote ${userName(u)}`}
                      onClick={() => setAdmin.mutate({ user: u, platformAdmin: true })}
                    >
                      Promote
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ConfirmDialog
        open={demoting !== null}
        title="Demote platform admin?"
        confirmLabel="Demote"
        pending={setAdmin.isPending}
        onConfirm={() => demoting && setAdmin.mutate({ user: demoting, platformAdmin: false })}
        onCancel={() => {
          setAdmin.reset();
          setDemoting(null);
        }}
        error={userError(setAdmin.error)?.message}
        fallbackFocus={table}
      >
        {demoting?.id === me?.id
          ? "You will no longer be able to manage platform admins."
          : `${demoting ? userName(demoting) : ""} will no longer be able to manage platform admins.`}
      </ConfirmDialog>
    </div>
  );
}
