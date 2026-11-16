import { renderModule } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import iam from "./index.tsx";
import { alice, directoryService, person } from "./testing.ts";

const admin = { ...alice, platformAdmin: true };
const directory = () => directoryService([person("alice", true), person("bob"), person("carol")]);

describe("Users", () => {
  beforeAll(polyfillDialog);

  it("lists the users with their roles to a platform admin", async () => {
    const { container } = renderModule(iam, directory().transport, "/users", admin);
    const table = await screen.findByRole("table", { name: "Users" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText("Platform admin")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("(you)")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("bob@example.com")).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("does not show the directory to anyone else, nor ask for it", () => {
    const service = directory();
    renderModule(iam, service.transport, "/users", alice);
    expect(screen.getByText("Only platform admins can see the users.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Users" })).toBeNull();
    expect(service.calls.listUsers).not.toHaveBeenCalled();
  });

  it("promotes a user", async () => {
    const service = directory();
    renderModule(iam, service.transport, "/users", admin);
    fireEvent.click(await screen.findByRole("button", { name: "Promote Bob" }));
    await waitFor(() =>
      expect(service.calls.setPlatformAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "bob", platformAdmin: true }),
      ),
    );
    expect(await screen.findByRole("button", { name: "Demote Bob" })).toBeTruthy();
  });

  it("demotes a platform admin after a confirmation", async () => {
    const service = directoryService([person("alice", true), person("bob", true)]);
    renderModule(iam, service.transport, "/users", admin);
    fireEvent.click(await screen.findByRole("button", { name: "Demote Bob" }));
    expect(service.calls.setPlatformAdmin).not.toHaveBeenCalled();
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Demote" }),
    );
    await waitFor(() =>
      expect(service.calls.setPlatformAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "bob", platformAdmin: false }),
      ),
    );
    expect(await screen.findByRole("button", { name: "Promote Bob" })).toBeTruthy();
  });

  it("explains that the last platform admin stays", async () => {
    renderModule(iam, directory().transport, "/users", admin);
    fireEvent.click(await screen.findByRole("button", { name: "Demote Alice" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Demote" }),
    );
    expect(await screen.findByText(/needs at least one admin/)).toBeTruthy();
  });

  it("waits for the current user instead of denying", () => {
    const service = directory();
    renderModule(iam, service.transport, "/users", null, "loading");
    expect(screen.queryByText("Only platform admins can see the users.")).toBeNull();
    expect(service.calls.listUsers).not.toHaveBeenCalled();
  });

  it("says some actions are unavailable when the current user could not be loaded", () => {
    renderModule(iam, directory().transport, "/users", null, "failed");
    expect(screen.getByText(/Your account could not be loaded/)).toBeTruthy();
    expect(screen.queryByText("Only platform admins can see the users.")).toBeNull();
  });

  it("keeps the dialog open with the error when demoting fails", async () => {
    renderModule(iam, directory().transport, "/users", admin);
    fireEvent.click(await screen.findByRole("button", { name: "Demote Alice" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Demote" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/needs at least one admin/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
