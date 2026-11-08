import { User, type UserManager } from "oidc-client-ts";
import { vi } from "vitest";

/** A signed-in user whose access token is valid for another hour. */
export function fakeUser(extra: Partial<ConstructorParameters<typeof User>[0]> = {}): User {
  return new User({
    access_token: "access",
    token_type: "Bearer",
    profile: {
      sub: "alice-sub",
      iss: "http://dex",
      aud: "kb-web",
      exp: 0,
      iat: 0,
      name: "alice",
      email: "alice@example.com",
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  });
}

/**
 * A UserManager with no stored session that records redirects instead of
 * leaving the page. `loadUser` fires its userLoaded event, like a silent renew.
 */
export function fakeManager(overrides: Partial<Record<keyof UserManager, unknown>> = {}) {
  const loaded = new Set<(user: User) => void>();
  const manager = {
    getUser: vi.fn(async (): Promise<User | null> => null),
    removeUser: vi.fn(async () => {}),
    signinRedirect: vi.fn(async () => {}),
    signinRedirectCallback: vi.fn(),
    signinSilent: vi.fn(),
    events: {
      addUserLoaded: (cb: (user: User) => void) => loaded.add(cb),
      removeUserLoaded: (cb: (user: User) => void) => loaded.delete(cb),
    },
    ...overrides,
  };
  return {
    manager: manager as unknown as UserManager & typeof manager,
    loadUser: (user: User) => {
      for (const cb of loaded) cb(user);
    },
  };
}
