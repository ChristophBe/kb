import { createContext, type ReactNode, useContext, useMemo } from "react";

/** The signed-in user as the platform's user registry knows them. */
export interface CurrentUser {
  /** The subject of the user's token, the id other modules store as an owner. */
  id: string;
  email: string;
  displayName: string;
  platformAdmin: boolean;
}

/**
 * Whether the user is still being loaded (`loading`), is known or not expected
 * (`ready`: no user then means the shell runs without sign-in), or could not be
 * loaded (`failed`, e.g. while the user registry is down).
 */
export type CurrentUserStatus = "loading" | "ready" | "failed";

interface CurrentUserState {
  user: CurrentUser | null;
  status: CurrentUserStatus;
}

const CurrentUserContext = createContext<CurrentUserState>({ user: null, status: "ready" });

/** The shell provides the user once it is known; module code reads it with `useCurrentUser`. */
export function CurrentUserProvider({
  user,
  status = "ready",
  children,
}: {
  user: CurrentUser | null;
  status?: CurrentUserStatus;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ user, status }), [user, status]);
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

/**
 * The signed-in user; null while it loads, when the shell runs without sign-in
 * and while the user registry is unavailable.
 */
export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext).user;
}

/**
 * Whether the user is still loading or could not be loaded. Pages that show
 * something only to some users wait for `ready` before denying anything, and
 * say so on `failed` instead of hiding controls silently.
 */
export function useCurrentUserStatus(): CurrentUserStatus {
  return useContext(CurrentUserContext).status;
}

/** Whether the signed-in user is a platform admin; false until the user is known. */
export function useIsPlatformAdmin(): boolean {
  return useCurrentUser()?.platformAdmin ?? false;
}
