import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  type Document,
  DocumentService,
  DocumentStatus,
} from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { IamService, TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import type { CurrentUser } from "@knowcel/module-sdk";
import { errorInfoDetail } from "@knowcel/ui/testing/errors";
import { vi } from "vitest";

export const alice: CurrentUser = {
  id: "alice",
  email: "alice@example.com",
  displayName: "Alice",
  platformAdmin: false,
};

export const bob: CurrentUser = { ...alice, id: "bob", email: "bob@example.com" };

export interface TestDoc {
  id: string;
  title: string;
  ownerId: string;
  teamIds?: string[];
}

export interface TestTeam {
  id: string;
  name: string;
  role: TeamRole;
}

/**
 * A document service over `initial`, and an IAM service listing `teams` as the
 * caller's. `iam: false` leaves IAM unimplemented, like a stack without it.
 * `setDocumentTeams` rejects with TEAM_NOT_FOUND `rejections` times first.
 */
export function sharingService(
  initial: TestDoc[],
  teams: TestTeam[],
  { iam = true, rejections = 0 }: { iam?: boolean; rejections?: number } = {},
) {
  const docs = initial.map((d) => ({ ...d, teamIds: [...(d.teamIds ?? [])] }));
  const setDocumentTeams = vi.fn();
  let rejected = 0;
  const view = (d: (typeof docs)[number]) =>
    ({
      id: d.id,
      title: d.title,
      filename: `${d.title}.md`,
      status: DocumentStatus.READY,
      ownerId: d.ownerId,
      teamIds: d.teamIds,
    }) as Document;
  const transport = createRouterTransport(({ service }) => {
    service(DocumentService, {
      listDocuments: () => ({ documents: docs.map(view) }),
      getDocument: ({ id }) => {
        const d = docs.find((x) => x.id === id);
        if (!d) throw new ConnectError("not found", Code.NotFound);
        return { document: view(d) };
      },
      listChunks: () => ({ chunks: [] }),
      setDocumentTeams: (req) => {
        setDocumentTeams(req);
        if (rejected < rejections) {
          rejected++;
          const err = new ConnectError("team not found", Code.NotFound);
          err.details.push(
            errorInfoDetail({ reason: "TEAM_NOT_FOUND", domain: "knowcel.document.v1" }),
          );
          throw err;
        }
        const d = docs.find((x) => x.id === req.id);
        if (!d) throw new ConnectError("not found", Code.NotFound);
        d.teamIds = [...req.teamIds];
        return { document: view(d) };
      },
    });
    if (iam) {
      service(IamService, {
        listMyTeams: () => ({
          teams: teams.map((t) => ({ id: t.id, name: t.name, myRole: t.role, members: [] })),
        }),
      });
    }
  });
  return { transport, setDocumentTeams };
}

export const ADMIN = TeamRole.ADMIN;
export const MEMBER = TeamRole.MEMBER;
