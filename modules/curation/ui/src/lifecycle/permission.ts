import type { Document } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { type Team, TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import type { CurrentUser } from "@knowcel/module-sdk";

/**
 * Whether the user may change a document's approval state: its owner, an admin
 * of a team it is shared with, or a platform admin. This only decides whether
 * the button is offered; the service decides for real. Without a signed-in
 * user (no sign-in configured), or without the user's teams (`myTeams` is
 * undefined while IAM can't be asked), the service decides alone.
 */
export function mayChange(
  user: CurrentUser | null,
  document: Pick<Document, "ownerId" | "teamIds">,
  myTeams: readonly Pick<Team, "id" | "myRole">[] | undefined,
): boolean {
  if (!user) return true;
  if (user.platformAdmin || user.id === document.ownerId) return true;
  if (!myTeams) return true;
  return document.teamIds.some((id) =>
    myTeams.some((t) => t.id === id && t.myRole === TeamRole.ADMIN),
  );
}
