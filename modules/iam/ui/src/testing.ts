import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  IamService,
  type Team,
  type TeamMember,
  TeamRole,
} from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import type { CurrentUser } from "@knowcel/module-sdk";
import { errorInfoDetail } from "@knowcel/ui/testing/errors";
import { vi } from "vitest";

export const alice: CurrentUser = {
  id: "alice",
  email: "alice@example.com",
  displayName: "Alice",
  platformAdmin: false,
};

const member = (id: string, role: TeamRole): TeamMember =>
  ({
    userId: id,
    email: `${id}@example.com`,
    displayName: id[0]?.toUpperCase() + id.slice(1),
    role,
  }) as TeamMember;

export const admin = (id: string) => member(id, TeamRole.ADMIN);
export const plain = (id: string) => member(id, TeamRole.MEMBER);

function failed(reason: string, code: Code) {
  const err = new ConnectError(reason, code);
  err.details.push(errorInfoDetail({ reason, domain: "knowcel.iam.v1" }));
  return err;
}

/**
 * An in-memory IAM service for `me` (alice) over `initial` teams, enforcing the
 * rules the page relies on: the last admin stays, an unknown email is
 * NOT_FOUND. `registered` are the emails `addMember` finds.
 */
export function iamService(
  initial: { id: string; name: string; members: TeamMember[] }[],
  registered: string[] = [],
) {
  const teams = new Map(initial.map((t) => [t.id, { ...t, members: [...t.members] }]));
  const roleOf = (t: { members: TeamMember[] }) =>
    t.members.find((m) => m.userId === alice.id)?.role ?? TeamRole.UNSPECIFIED;
  const view = (id: string, members: boolean): Team => {
    const t = teams.get(id);
    if (!t || roleOf(t) === TeamRole.UNSPECIFIED)
      throw new ConnectError("not found", Code.NotFound);
    return { id, name: t.name, myRole: roleOf(t), members: members ? t.members : [] } as Team;
  };
  const calls = {
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
    deleteTeam: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    setMemberRole: vi.fn(),
  };
  let next = 1;
  const transport = createRouterTransport(({ service }) =>
    service(IamService, {
      listMyTeams: () => ({
        teams: [...teams.keys()].flatMap((id) => {
          try {
            return [view(id, false)];
          } catch {
            return [];
          }
        }),
      }),
      getTeam: ({ id }) => ({ team: view(id, true) }),
      createTeam: (req) => {
        calls.createTeam(req);
        const id = `new-${next++}`;
        teams.set(id, { id, name: req.name, members: [admin(alice.id)] });
        return { team: view(id, true) };
      },
      updateTeam: (req) => {
        calls.updateTeam(req);
        const t = teams.get(req.id);
        if (t) t.name = req.name;
        return { team: view(req.id, true) };
      },
      deleteTeam: (req) => {
        calls.deleteTeam(req);
        teams.delete(req.id);
        return {};
      },
      addMember: (req) => {
        calls.addMember(req);
        const t = teams.get(req.teamId);
        if (!registered.includes(req.email)) throw failed("USER_NOT_FOUND", Code.NotFound);
        if (t?.members.some((m) => m.email === req.email)) {
          throw new ConnectError("exists", Code.AlreadyExists);
        }
        const added = plain(req.email.split("@")[0] ?? "");
        t?.members.push(added);
        return { member: added };
      },
      removeMember: (req) => {
        calls.removeMember(req);
        const t = teams.get(req.teamId);
        const target = t?.members.find((m) => m.userId === req.userId);
        const admins = t?.members.filter((m) => m.role === TeamRole.ADMIN) ?? [];
        if (target?.role === TeamRole.ADMIN && admins.length === 1) {
          throw failed("LAST_ADMIN", Code.FailedPrecondition);
        }
        if (t) t.members = t.members.filter((m) => m.userId !== req.userId);
        return {};
      },
      setMemberRole: (req) => {
        calls.setMemberRole(req);
        const t = teams.get(req.teamId);
        const target = t?.members.find((m) => m.userId === req.userId);
        const admins = t?.members.filter((m) => m.role === TeamRole.ADMIN) ?? [];
        if (target?.role === TeamRole.ADMIN && req.role !== TeamRole.ADMIN && admins.length === 1) {
          throw failed("LAST_ADMIN", Code.FailedPrecondition);
        }
        if (target) target.role = req.role;
        return { member: target };
      },
    }),
  );
  return { transport, calls };
}
