import type { RuntimeAuth } from "@kb/module-sdk";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate, useSession } from "./AuthGate.tsx";
import { CALLBACK_PATH } from "./session.ts";
import { fakeManager, fakeUser } from "./testing/fakes.ts";

function Who() {
  const session = useSession();
  return session ? (
    <>
      <p>Hello {session.name}</p>
      <button type="button" onClick={session.signOut}>
        Sign out
      </button>
    </>
  ) : null;
}

function renderGate(manager: ReturnType<typeof fakeManager>["manager"]) {
  let auth: RuntimeAuth | undefined;
  const result = render(
    <StrictMode>
      <AuthGate manager={manager}>
        {(a) => {
          auth = a;
          return <Who />;
        }}
      </AuthGate>
    </StrictMode>,
  );
  return { ...result, auth: () => auth as RuntimeAuth };
}

describe("AuthGate", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("renders the app with the user's token once signed in", async () => {
    const { manager, loadUser } = fakeManager({ getUser: vi.fn(async () => fakeUser()) });
    const { auth } = renderGate(manager);
    expect(await screen.findByText("Hello alice")).toBeTruthy();
    expect(auth().accessToken()).toBe("access");

    act(() => loadUser(fakeUser({ access_token: "renewed" })));
    expect(auth().accessToken()).toBe("renewed");
  });

  it("completes the provider's redirect only once under StrictMode", async () => {
    window.history.replaceState(null, "", `${CALLBACK_PATH}?code=c&state=s`);
    const { manager } = fakeManager({
      signinRedirectCallback: vi.fn(async () => fakeUser({ userState: { returnTo: "/help" } })),
    });
    renderGate(manager);
    expect(await screen.findByText("Hello alice")).toBeTruthy();
    expect(manager.signinRedirectCallback).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/help");
  });

  it("shows that it signs in while the browser goes to the provider", async () => {
    vi.useFakeTimers();
    const { manager } = fakeManager();
    renderGate(manager);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(manager.signinRedirect).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: "Signing in" })).toBeTruthy();
    expect(screen.queryByText(/Hello/)).toBeNull();
  });

  it("signs in again, at the same route, once the gateway rejects the token", async () => {
    const { manager } = fakeManager({ getUser: vi.fn(async () => fakeUser()) });
    const { auth } = renderGate(manager);
    await screen.findByText("Hello alice");
    window.history.replaceState(null, "", "/m/chat/7");

    await act(async () => {
      // Several calls fail at once; the browser leaves once.
      auth().onUnauthenticated();
      auth().onUnauthenticated();
    });
    expect(screen.queryByText("Hello alice")).toBeNull();
    expect(await screen.findByText(/Your session has expired/)).toBeTruthy();
    expect(manager.removeUser).toHaveBeenCalledOnce();
    expect(manager.signinRedirect).toHaveBeenCalledExactlyOnceWith({
      state: { returnTo: "/m/chat/7" },
    });
  });

  it("explains a failed sign-in and retries it", async () => {
    const { manager } = fakeManager({
      signinRedirect: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(undefined),
    });
    const { container } = renderGate(manager);
    expect(await screen.findByRole("heading", { name: "Couldn't sign you in" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "Sign-in isn't available right now. Try again in a moment.",
    );
    await expectNoAxeViolations(container);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(manager.signinRedirect).toHaveBeenCalledTimes(2));
  });

  it("shows the provider's reason when it refused the sign-in", async () => {
    window.history.replaceState(null, "", `${CALLBACK_PATH}?error=access_denied&state=s`);
    const { manager } = fakeManager({
      signinRedirectCallback: vi.fn(async () => {
        throw Object.assign(new Error("access_denied"), {
          error: "access_denied",
          error_description: "the user declined",
        });
      }),
    });
    renderGate(manager);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "The sign-in was refused: the user declined",
    );
  });

  it("signs out and offers to sign in again", async () => {
    const { manager } = fakeManager({ getUser: vi.fn(async () => fakeUser()) });
    const { auth, container } = renderGate(manager);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(screen.getByRole("heading", { name: "You're signed out" })).toBeTruthy();
    expect(manager.removeUser).toHaveBeenCalledOnce();
    expect(auth().accessToken()).toBeUndefined();
    await expectNoAxeViolations(container);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(manager.signinRedirect).toHaveBeenCalledOnce());
  });
});
