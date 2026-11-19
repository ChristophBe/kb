import { Code, ConnectError } from "@knowcel/module-sdk";

/** What a failed request for findings means for the user, in the words the page shows. */
export function findingsError(err: unknown): Error | null {
  if (!err) return null;
  const error = ConnectError.from(err);
  switch (error.code) {
    case Code.Unavailable:
      return new Error("Documents aren't available right now. Try again in a moment.");
    case Code.Unauthenticated:
      return new Error("Sign in to see your document checks.");
    default:
      return new Error(error.rawMessage);
  }
}

/** What a failed attempt to close a finding means for the user. */
export function resolveError(err: unknown): Error | null {
  if (!err) return null;
  const error = ConnectError.from(err);
  switch (error.code) {
    case Code.FailedPrecondition:
      return new Error("This finding has already been resolved.");
    case Code.NotFound:
      return new Error("This finding or one of its documents is no longer available.");
    default:
      return findingsError(err);
  }
}

/** Whether the finding is gone for good, so the list should be refreshed instead of retried. */
export function findingIsGone(err: unknown): boolean {
  const code = ConnectError.from(err).code;
  return code === Code.FailedPrecondition || code === Code.NotFound;
}
