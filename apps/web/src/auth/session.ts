import type { RuntimeConfig } from "@kb/module-sdk";
import { type User, UserManager, WebStorageStateStore } from "oidc-client-ts";

/** Where the identity provider sends the browser back to; registered with the provider. */
export const CALLBACK_PATH = "/auth/callback";

export function createUserManager(auth: NonNullable<RuntimeConfig["auth"]>): UserManager {
  return new UserManager({
    authority: auth.issuer,
    client_id: auth.clientId,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    // offline_access gets a refresh token, which renews the access token
    // before it expires (automaticSilentRenew) without leaving the page.
    scope: "openid profile email offline_access",
    // localStorage keeps the session across tabs and reloads. Dex keeps no
    // login session of its own, so sessionStorage would ask for the password
    // in every new tab.
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
}

/** The current location, to come back to after signing in. */
export function currentPath(): string {
  const { pathname, search, hash } = window.location;
  return pathname === CALLBACK_PATH ? "/" : pathname + search + hash;
}

/** A path from the sign-in state, limited to this origin so a crafted state can't send the user elsewhere. */
function returnPath(state: unknown): string {
  const to = (state as { returnTo?: unknown } | undefined)?.returnTo;
  return typeof to === "string" && /^\/(?![/\\])/.test(to) ? to : "/";
}

/** Sends the browser to the identity provider; it comes back to `returnTo`. */
export function signIn(manager: UserManager, returnTo = currentPath()): Promise<void> {
  return manager.signinRedirect({ state: { returnTo } });
}

/**
 * Signs the user in before the shell renders: completes the redirect back
 * from the identity provider (restoring the route asked for), or uses the
 * stored session, refreshing it when it has expired, or else sends the browser
 * to the provider. Resolves with the user, or with null while the browser leaves.
 */
export async function startSession(manager: UserManager): Promise<User | null> {
  const { pathname, search } = window.location;
  if (pathname === CALLBACK_PATH && new URLSearchParams(search).has("state")) {
    const user = await manager.signinRedirectCallback();
    window.history.replaceState(null, "", returnPath(user.state));
    return user;
  }
  let user = await manager.getUser();
  if (user?.expired && user.refresh_token) user = await manager.signinSilent().catch(() => null);
  if (user && !user.expired) return user;
  await signIn(manager);
  return null;
}

/** The name the shell shows for the signed-in user. */
export function displayName(user: User): string {
  const { name, preferred_username, email, sub } = user.profile;
  return name ?? preferred_username ?? email ?? sub;
}
