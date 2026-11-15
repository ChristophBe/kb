import { createContext, type ReactNode, useContext } from "react";

/** The signed-in user as the platform's user registry knows them. */
export interface CurrentUser {
  /** The subject of the user's token, the id other modules store as an owner. */
  id: string;
  email: string;
  displayName: string;
  platformAdmin: boolean;
}

const CurrentUserContext = createContext<CurrentUser | null>(null);

/** The shell provides the user once it is known; module code reads it with `useCurrentUser`. */
export function CurrentUserProvider({
  user,
  children,
}: {
  user: CurrentUser | null;
  children: ReactNode;
}) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

/**
 * The signed-in user; null while it loads, when the shell runs without sign-in
 * and while the user registry is unavailable.
 */
export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}

/** Whether the signed-in user is a platform admin; false until the user is known. */
export function useIsPlatformAdmin(): boolean {
  return useCurrentUser()?.platformAdmin ?? false;
}
