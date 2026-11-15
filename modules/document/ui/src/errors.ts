import { Code, ConnectError } from "@knowcel/module-sdk";
import { isTeamNotFound, TEAM_NOT_FOUND_MESSAGE } from "@knowcel/ui";

/** What a failed request to change the sharing of a document means for the user. */
export function shareError(err: unknown): Error | null {
  if (!err) return null;
  if (isTeamNotFound(err)) return new Error(TEAM_NOT_FOUND_MESSAGE);
  const error = ConnectError.from(err);
  if (error.code === Code.PermissionDenied) {
    return new Error("You can't change who this document is shared with.");
  }
  return new Error(error.rawMessage);
}
