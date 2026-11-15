import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type CurrentUser,
  CurrentUserProvider,
  useCurrentUser,
  useIsPlatformAdmin,
} from "./user.tsx";

const alice: CurrentUser = {
  id: "alice-sub",
  email: "alice@example.com",
  displayName: "Alice",
  platformAdmin: true,
};

function Probe() {
  const user = useCurrentUser();
  return (
    <p>
      {user?.email ?? "nobody"} {useIsPlatformAdmin() ? "admin" : "not admin"}
    </p>
  );
}

describe("current user", () => {
  it("is unknown and not an admin without a provider or a user", () => {
    render(<Probe />);
    expect(screen.getByText("nobody not admin")).toBeTruthy();
  });

  it("gives the user and whether they are a platform admin", () => {
    render(
      <CurrentUserProvider user={alice}>
        <Probe />
      </CurrentUserProvider>,
    );
    expect(screen.getByText("alice@example.com admin")).toBeTruthy();
  });

  it("is not an admin when the user is not", () => {
    render(
      <CurrentUserProvider user={{ ...alice, platformAdmin: false }}>
        <Probe />
      </CurrentUserProvider>,
    );
    expect(screen.getByText("alice@example.com not admin")).toBeTruthy();
  });
});
