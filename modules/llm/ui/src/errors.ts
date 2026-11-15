import { Code, ConnectError } from "@knowcel/module-sdk";

/** What a failed model request means for the user, in the words the page shows. */
export function modelError(err: unknown): Error | null {
  if (!err) return null;
  const error = ConnectError.from(err);
  switch (error.code) {
    case Code.PermissionDenied:
      return new Error("Only platform admins can pull and delete models.");
    case Code.NotFound:
      return new Error("The provider doesn't have this model. Check the name.");
    case Code.Unimplemented:
      return new Error("This provider's models can't be managed here.");
    default:
      return new Error(error.rawMessage);
  }
}
