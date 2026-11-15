import {
  IamService,
  type Team,
  type TeamMember,
  TeamRole,
} from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  Code,
  ConnectError,
  toast,
  useClient,
  useCurrentUser,
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
  Dialog,
  EmptyState,
  ErrorMessage,
  fieldError,
  IconButton,
  Input,
  SkeletonRows,
  useDocumentTitle,
} from "@knowcel/ui";
import { UserMinus, UsersRound } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { teamError } from "./errors.ts";

const roleLabel: Record<TeamRole, string> = {
  [TeamRole.UNSPECIFIED]: "Member",
  [TeamRole.ADMIN]: "Admin",
  [TeamRole.MEMBER]: "Member",
};

/** The name a member is listed by. */
const memberName = (m: TeamMember) => m.displayName || m.email;

export function TeamDetail() {
  const { id = "" } = useParams();
  const client = useClient(IamService);
  const team = useQuery({
    queryKey: ["team", id],
    queryFn: () => client.getTeam({ id }),
  });
  if (team.isPending) {
    return (
      <Card>
        <DelayedLoading>
          <SkeletonRows label="Loading team" />
        </DelayedLoading>
      </Card>
    );
  }
  if (team.error) {
    // A team the caller isn't in doesn't exist for them.
    return ConnectError.from(team.error).code === Code.NotFound ? (
      <Card>
        <EmptyState icon={UsersRound}>This team doesn't exist, or you aren't a member.</EmptyState>
      </Card>
    ) : (
      <ErrorMessage error={teamError(team.error)} />
    );
  }
  return team.data.team ? <TeamView team={team.data.team} /> : null;
}

function TeamView({ team }: { team: Team }) {
  const client = useClient(IamService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const isAdmin = team.myRole === TeamRole.ADMIN;
  useDocumentTitle(team.name);

  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The member the remove or leave confirmation asks about.
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const members = useRef<HTMLTableElement>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["team", team.id] }),
      queryClient.invalidateQueries({ queryKey: ["teams"] }),
    ]);
  const gone = async () => {
    await queryClient.invalidateQueries({ queryKey: ["teams"] });
    queryClient.removeQueries({ queryKey: ["team", team.id] });
    navigate("..", { relative: "path" });
  };

  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: TeamRole }) =>
      client.setMemberRole({ teamId: team.id, ...v }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => client.removeMember({ teamId: team.id, userId }),
    onSuccess: async (_, userId) => {
      if (userId === me?.id) {
        toast.success("You left the team");
        await gone();
      } else {
        toast.success("Member removed");
        await refresh();
      }
    },
    onSettled: () => setRemoving(null),
  });
  const destroy = useMutation({
    mutationFn: () => client.deleteTeam({ id: team.id }),
    onSuccess: async () => {
      toast.success("Team deleted");
      await gone();
    },
    onSettled: () => setDeleting(false),
  });

  const leaving = removing !== null && removing.userId === me?.id;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl">{team.name}</h2>
        <Badge tone={isAdmin ? "info" : "neutral"}>{roleLabel[team.myRole]}</Badge>
        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <>
              <Button variant="secondary" onClick={() => setRenaming(true)}>
                Rename
              </Button>
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Delete team
              </Button>
            </>
          )}
        </div>
      </div>
      <ErrorMessage error={teamError(setRole.error ?? remove.error ?? destroy.error)} />
      <Card className="overflow-x-auto">
        <table ref={members} tabIndex={-1} aria-label="Members" className="w-full text-sm">
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
            {team.members.map((m) => {
              const self = m.userId === me?.id;
              return (
                <tr key={m.userId} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    {memberName(m)}
                    {self && <span className="ml-2 text-xs text-fg-muted">(you)</span>}
                  </th>
                  <td className="px-4 py-2 font-mono text-fg-muted">{m.email}</td>
                  <td className="px-4 py-2">
                    {isAdmin ? (
                      <select
                        aria-label={`Role of ${memberName(m)}`}
                        value={m.role}
                        disabled={setRole.isPending}
                        onChange={(e) =>
                          setRole.mutate({ userId: m.userId, role: Number(e.target.value) })
                        }
                        className="rounded-control border border-border-strong bg-surface px-2 py-1 text-sm hover:border-fg-muted"
                      >
                        <option value={TeamRole.ADMIN}>Admin</option>
                        <option value={TeamRole.MEMBER}>Member</option>
                      </select>
                    ) : (
                      roleLabel[m.role]
                    )}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {self ? (
                      <Button variant="ghost" onClick={() => setRemoving(m)}>
                        Leave team
                      </Button>
                    ) : (
                      isAdmin && (
                        <IconButton
                          label={`Remove ${memberName(m)}`}
                          tone="danger"
                          onClick={() => setRemoving(m)}
                        >
                          <UserMinus className="size-4" />
                        </IconButton>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {isAdmin && <AddMember teamId={team.id} onAdded={refresh} />}
      <RenameDialog team={team} open={renaming} onClose={() => setRenaming(false)} />
      <ConfirmDialog
        open={removing !== null}
        title={leaving ? "Leave team?" : "Remove member?"}
        confirmLabel={leaving ? "Leave" : "Remove"}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.userId)}
        onCancel={() => setRemoving(null)}
        fallbackFocus={members}
      >
        {leaving
          ? `You will no longer see documents shared with “${team.name}”.`
          : `${removing ? memberName(removing) : ""} will no longer see documents shared with “${team.name}”.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={deleting}
        title="Delete team?"
        confirmLabel="Delete"
        pending={destroy.isPending}
        onConfirm={() => destroy.mutate()}
        onCancel={() => setDeleting(false)}
      >
        “{team.name}” and its memberships will be deleted. Documents shared with it become private
        to their owners. This can't be undone.
      </ConfirmDialog>
    </div>
  );
}

function AddMember({ teamId, onAdded }: { teamId: string; onAdded: () => Promise<unknown> }) {
  const client = useClient(IamService);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const add = useMutation({
    mutationFn: (value: string) =>
      client.addMember({ teamId, email: value, role: TeamRole.MEMBER }),
    onSuccess: async () => {
      toast.success("Member added");
      setEmail("");
      await onAdded();
    },
    onError: (err) => {
      setError(teamError(err));
      input.current?.focus();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setError(new Error("Enter the email address of the person to add."));
      input.current?.focus();
      return;
    }
    setError(null);
    add.mutate(value);
  };
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-2">
      <label htmlFor="member-email" className="text-sm font-medium">
        Add a member by email
      </label>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id="member-email"
            ref={input}
            type="email"
            placeholder="name@example.com"
            value={email}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && (
            <p id={errorId} className="mt-1 text-xs text-danger">
              {error.message}
            </p>
          )}
        </div>
        <Button type="submit" disabled={add.isPending}>
          Add member
        </Button>
      </div>
    </form>
  );
}

function RenameDialog({ team, open, onClose }: { team: Team; open: boolean; onClose: () => void }) {
  const client = useClient(IamService);
  const queryClient = useQueryClient();
  const [name, setName] = useState(team.name);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const rename = useMutation({
    mutationFn: (value: string) => client.updateTeam({ id: team.id, name: value }),
    onSuccess: async () => {
      toast.success("Team renamed");
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["team", team.id] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
      ]);
    },
    onError: (err) => setError(fieldError(err, "name") ?? teamError(err)?.message ?? ""),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) {
      setError("Team name must not be empty");
      input.current?.focus();
      return;
    }
    setError("");
    rename.mutate(value);
  };
  return (
    <Dialog
      open={open}
      onClose={() => {
        setName(team.name);
        setError("");
        onClose();
      }}
      title="Rename team"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="rename-team" disabled={rename.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="rename-team" onSubmit={submit} className="flex flex-col gap-1">
        <label htmlFor="rename-team-name" className="font-medium">
          Team name
        </label>
        <Input
          id="rename-team-name"
          ref={input}
          autoFocus
          value={name}
          aria-invalid={error !== ""}
          onChange={(e) => setName(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
