import { Code, ConnectError } from "@knowcel/module-sdk";
import { brandText, errorInfo } from "@knowcel/ui";

/** What a failed team request means for the user, in the words the page shows. */
export function teamError(err: unknown): Error | null {
  if (!err) return null;
  const reason = errorInfo(err)?.reason;
  if (reason === "LAST_ADMIN") {
    return new Error("A team needs at least one admin. Make someone else an admin first.");
  }
  if (reason === "USER_NOT_FOUND") {
    return new Error(
      brandText(
        "No one with this email address is registered yet. They need to sign in to Knowcelium once.",
      ),
    );
  }
  const error = ConnectError.from(err);
  if (error.code === Code.AlreadyExists) return new Error("This person is already a member.");
  return new Error(error.rawMessage);
}

/** What a failed request of the user directory means for the user. */
export function userError(err: unknown): Error | null {
  if (!err) return null;
  if (errorInfo(err)?.reason === "LAST_PLATFORM_ADMIN") {
    return new Error("The platform needs at least one admin. Promote someone else first.");
  }
  if (ConnectError.from(err).code === Code.PermissionDenied) {
    return new Error("Only platform admins can do this.");
  }
  return new Error(ConnectError.from(err).rawMessage);
}
