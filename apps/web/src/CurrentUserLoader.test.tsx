import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { IamService } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import {
  KbRuntimeProvider,
  useCurrentUser,
  useCurrentUserStatus,
  useIsPlatformAdmin,
} from "@knowcel/module-sdk";
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthGate } from "./auth/AuthGate.tsx";
import { fakeManager, fakeUser } from "./auth/testing/fakes.ts";
import { CurrentUserLoader } from "./CurrentUserLoader.tsx";

function Probe() {
  const user = useCurrentUser();
  const admin = useIsPlatformAdmin();
  const status = useCurrentUserStatus();
  return <p>{user ? `${user.displayName} ${admin ? "admin" : "member"}` : `unknown ${status}`}</p>;
}

/** The loader inside a signed-in shell, against `getCurrentUser`. */
function renderLoader(getCurrentUser: () => unknown) {
  const transport = createRouterTransport(({ service }) =>
    service(IamService, { getCurrentUser: getCurrentUser as never }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { manager } = fakeManager({ getUser: vi.fn(async () => fakeUser()) });
  const tree = (
    <AuthGate manager={manager}>
      {() => (
        <KbRuntimeProvider
          config={{ apiBaseUrl: "http://test" }}
          transport={transport}
          client={client}
        >
          <CurrentUserLoader>
            <Probe />
          </CurrentUserLoader>
        </KbRuntimeProvider>
      )}
    </AuthGate>
  );
  return { ...render(tree), tree };
}

describe("CurrentUserLoader", () => {
  it("registers the user once and provides them, with their admin role", async () => {
    const getCurrentUser = vi.fn(() => ({
      user: { id: "alice", email: "alice@example.com", displayName: "Alice", platformAdmin: true },
    }));
    const { rerender, tree } = renderLoader(getCurrentUser);
    expect(await screen.findByText("Alice admin")).toBeTruthy();
    rerender(tree);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("provides a plain member as not an admin", async () => {
    renderLoader(() => ({
      user: { id: "bob", email: "bob@example.com", displayName: "Bob", platformAdmin: false },
    }));
    expect(await screen.findByText("Bob member")).toBeTruthy();
  });

  it("falls back to no user when the user registry is unavailable", async () => {
    const getCurrentUser = vi.fn(() => {
      throw new ConnectError("down", Code.Unavailable);
    });
    renderLoader(getCurrentUser);
    await vi.waitFor(() => expect(getCurrentUser).toHaveBeenCalled());
    // The query retries once before it gives up.
    await vi.waitFor(() => expect(screen.getByText("unknown failed")).toBeTruthy(), {
      timeout: 5000,
    });
  });
});
