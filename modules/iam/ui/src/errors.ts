import { Code, ConnectError } from "@knowcel/module-sdk";
import { errorInfo } from "@knowcel/ui";

/** What a failed team request means for the user, in the words the page shows. */
export function teamError(err: unknown): Error | null {
  if (!err) return null;
  const reason = errorInfo(err)?.reason;
  if (reason === "LAST_ADMIN") {
    return new Error("A team needs at least one admin. Make someone else an admin first.");
  }
  if (reason === "USER_NOT_FOUND") {
    return new Error(
      "No one with this email address is registered yet. They need to sign in to Knowcelium once.",
    );
  }
  const error = ConnectError.from(err);
  if (error.code === Code.AlreadyExists) return new Error("This person is already a member.");
  return new Error(error.rawMessage);
}
