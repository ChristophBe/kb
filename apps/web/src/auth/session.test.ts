import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALLBACK_PATH,
  createUserManager,
  currentPath,
  displayName,
  startSession,
} from "./session.ts";
import { fakeManager, fakeUser } from "./testing/fakes.ts";

const user = fakeUser;
const manager = (overrides: Parameters<typeof fakeManager>[0] = {}) =>
  fakeManager(overrides).manager;

describe("startSession", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("uses a stored session", async () => {
    const stored = user();
    const m = manager({ getUser: vi.fn(async () => stored) });
    await expect(startSession(m)).resolves.toBe(stored);
    expect(m.signinRedirect).not.toHaveBeenCalled();
  });

  it("sends a signed-out user to the provider with the route asked for", async () => {
    window.history.replaceState(null, "", "/m/document/42?tab=chunks#c3");
    const m = manager();
    await expect(startSession(m)).resolves.toBeNull();
    expect(m.signinRedirect).toHaveBeenCalledWith({
      state: { returnTo: "/m/document/42?tab=chunks#c3" },
    });
  });

  it("refreshes an expired session with its refresh token", async () => {
    const renewed = user({ access_token: "new" });
    const m = manager({
      getUser: vi.fn(async () => user({ expires_at: 1, refresh_token: "refresh" })),
      signinSilent: vi.fn(async () => renewed),
    });
    await expect(startSession(m)).resolves.toBe(renewed);
  });

  it("signs in again when the refresh fails", async () => {
    const m = manager({
      getUser: vi.fn(async () => user({ expires_at: 1, refresh_token: "refresh" })),
      signinSilent: vi.fn(async () => {
        throw new Error("invalid_grant");
      }),
    });
    await expect(startSession(m)).resolves.toBeNull();
    expect(m.signinRedirect).toHaveBeenCalledOnce();
  });

  it("completes the redirect and returns to the route asked for", async () => {
    window.history.replaceState(null, "", `${CALLBACK_PATH}?code=abc&state=xyz`);
    const signedIn = user({ userState: { returnTo: "/m/chat/new?q=hi" } });
    const m = manager({ signinRedirectCallback: vi.fn(async () => signedIn) });
    await expect(startSession(m)).resolves.toBe(signedIn);
    expect(window.location.pathname + window.location.search).toBe("/m/chat/new?q=hi");
  });

  it.each(["//evil.example/x", "https://evil.example/", "/\\evil.example", undefined])(
    "returns home instead of to %s",
    async (returnTo) => {
      window.history.replaceState(null, "", `${CALLBACK_PATH}?code=abc&state=xyz`);
      const m = manager({
        signinRedirectCallback: vi.fn(async () => user({ userState: { returnTo } })),
      });
      await startSession(m);
      expect(window.location.pathname).toBe("/");
    },
  );
});

describe("currentPath", () => {
  it("is home on the callback route", () => {
    window.history.replaceState(null, "", `${CALLBACK_PATH}?error=access_denied`);
    expect(currentPath()).toBe("/");
    window.history.replaceState(null, "", "/");
  });
});

describe("createUserManager", () => {
  it("uses the configured provider with a callback on this origin", () => {
    const m = createUserManager({ issuer: "http://localhost:5556/dex", clientId: "kb-web" });
    expect(m.settings.authority).toBe("http://localhost:5556/dex");
    expect(m.settings.client_id).toBe("kb-web");
    expect(m.settings.redirect_uri).toBe(`${window.location.origin}${CALLBACK_PATH}`);
    expect(m.settings.scope).toContain("offline_access");
  });
});

describe("displayName", () => {
  it("prefers the name, then the user name and the email", () => {
    expect(displayName(user())).toBe("alice");
    const noName = user();
    noName.profile = { ...noName.profile, name: undefined };
    expect(displayName(noName)).toBe("alice@example.com");
  });
});
