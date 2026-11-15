import { IamService, TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import { toast, useClient, useMutation, useQuery, useQueryClient } from "@knowcel/module-sdk";
import {
  Badge,
  Button,
  Card,
  DelayedLoading,
  ErrorMessage,
  fieldError,
  Input,
  navItemClass,
  PageHeader,
  SkeletonRows,
} from "@knowcel/ui";
import { type FormEvent, useId, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { teamError } from "./errors.ts";

/** The teams of the signed-in user, with a form to create one; a team's page opens beside the list. */
export function Teams() {
  const client = useClient(IamService);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => client.listMyTeams({}) });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const create = useMutation({
    mutationFn: (value: string) => client.createTeam({ name: value }),
    onSuccess: async ({ team }) => {
      toast.success("Team created");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      if (team) navigate(team.id);
    },
    onError: (err) => {
      setNameError(fieldError(err, "name") ?? "");
      input.current?.focus();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) {
      setNameError("Team name must not be empty");
      input.current?.focus();
      return;
    }
    setNameError("");
    create.mutate(value);
  };

  return (
    <div>
      <PageHeader
        eyebrow="knowcelium / teams"
        title="Teams"
        description="Group people into teams to share documents with them."
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-4">
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor="team-name" className="text-sm font-medium">
              New team
            </label>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  id="team-name"
                  ref={input}
                  placeholder="Team name"
                  value={name}
                  aria-invalid={nameError !== ""}
                  aria-describedby={nameError ? errorId : undefined}
                  onChange={(e) => setName(e.target.value)}
                />
                {nameError && (
                  <p id={errorId} className="mt-1 text-xs text-danger">
                    {nameError}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={create.isPending}>
                Create team
              </Button>
            </div>
          </form>
          <ErrorMessage error={create.error} exclude={["name"]} />
          <Card className="p-2">
            {teams.isPending ? (
              <DelayedLoading>
                <SkeletonRows label="Loading teams" />
              </DelayedLoading>
            ) : teams.error ? (
              <ErrorMessage error={teamError(teams.error)} />
            ) : teams.data.teams.length ? (
              <nav aria-label="Your teams">
                <ul className="flex flex-col gap-0.5">
                  {teams.data.teams.map((t) => (
                    <li key={t.id}>
                      <NavLink to={t.id} className={({ isActive }) => navItemClass(isActive)}>
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {t.myRole === TeamRole.ADMIN && <Badge>Admin</Badge>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : (
              <p className="px-3 py-2 text-sm text-fg-muted">
                You aren't in a team yet. Create one to get started.
              </p>
            )}
          </Card>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
