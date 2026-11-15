import { renderModule } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import iam from "./index.tsx";
import { admin, alice, iamService, plain } from "./testing.ts";

const render = (service: ReturnType<typeof iamService>, path = "/teams") =>
  renderModule(iam, service.transport, path, alice);

const ops = {
  one: iamService(
    [{ id: "t1", name: "Platform", members: [admin("alice"), plain("bob")] }],
    ["bob@example.com", "carol@example.com"],
  ),
};

describe("Teams", () => {
  beforeAll(polyfillDialog);

  it("lists the user's teams and marks the ones they administer", async () => {
    const service = iamService([
      { id: "t1", name: "Platform", members: [admin("alice")] },
      { id: "t2", name: "Support", members: [plain("alice"), admin("bob")] },
      { id: "t3", name: "Hidden", members: [admin("bob")] },
    ]);
    render(service);
    const nav = await screen.findByRole("navigation", { name: "Your teams" });
    expect(within(nav).getByRole("link", { name: /Platform/ })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: /Support/ })).toBeTruthy();
    expect(within(nav).queryByText("Hidden")).toBeNull();
    expect(
      within(within(nav).getByRole("link", { name: /Platform/ })).getByText("Admin"),
    ).toBeTruthy();
  });

  it("says so when the user has no team yet", async () => {
    render(iamService([]));
    expect(await screen.findByText(/aren't in a team yet/)).toBeTruthy();
  });

  it("creates a team and opens it", async () => {
    const service = iamService([]);
    const { router } = render(service);
    fireEvent.change(await screen.findByLabelText("New team"), { target: { value: "  Docs  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByRole("heading", { name: "Docs" })).toBeTruthy();
    expect(service.calls.createTeam).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Docs" }),
    );
    expect(router.state.location.pathname).toBe("/teams/new-1");
  });

  it("refuses an empty team name without a request", async () => {
    const service = iamService([]);
    render(service);
    fireEvent.click(await screen.findByRole("button", { name: "Create team" }));
    expect(screen.getByText("Team name must not be empty")).toBeTruthy();
    expect(service.calls.createTeam).not.toHaveBeenCalled();
  });

  it("shows members to a plain member without admin controls", async () => {
    const service = iamService([
      { id: "t2", name: "Support", members: [plain("alice"), admin("bob")] },
    ]);
    const { container } = render(service, "/teams/t2");
    const table = await screen.findByRole("table", { name: "Members" });
    expect(within(table).getByText("Bob")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete team" })).toBeNull();
    expect(screen.queryByLabelText("Add a member by email")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave team" })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("adds a member by email and promotes them", async () => {
    const service = ops.one;
    const { container } = render(service, "/teams/t1");
    fireEvent.change(await screen.findByLabelText("Add a member by email"), {
      target: { value: "carol@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const select = (await screen.findByLabelText("Role of Carol")) as HTMLSelectElement;
    expect(service.calls.addMember).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "t1", email: "carol@example.com" }),
    );
    fireEvent.change(select, { target: { value: "1" } });
    await waitFor(() =>
      expect((screen.getByLabelText("Role of Carol") as HTMLSelectElement).value).toBe("1"),
    );
    expect(service.calls.setMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "carol", role: 1 }),
    );
    await expectNoAxeViolations(container);
  });

  it("explains an unknown email and an existing member", async () => {
    render(
      iamService(
        [{ id: "t1", name: "Platform", members: [admin("alice"), plain("bob")] }],
        ["bob@example.com"],
      ),
      "/teams/t1",
    );
    const input = await screen.findByLabelText("Add a member by email");
    fireEvent.change(input, { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText(/No one with this email address is registered/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "bob@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("This person is already a member.")).toBeTruthy();
  });

  it("refuses to demote the last admin, with a message", async () => {
    render(
      iamService([{ id: "t1", name: "Platform", members: [admin("alice"), plain("bob")] }]),
      "/teams/t1",
    );
    fireEvent.change(await screen.findByLabelText("Role of Alice"), { target: { value: "2" } });
    expect(await screen.findByText(/A team needs at least one admin/)).toBeTruthy();
    expect((screen.getByLabelText("Role of Alice") as HTMLSelectElement).value).toBe("1");
  });

  it("removes a member after confirming", async () => {
    const service = iamService([
      { id: "t1", name: "Platform", members: [admin("alice"), plain("bob")] },
    ]);
    render(service, "/teams/t1");
    fireEvent.click(await screen.findByRole("button", { name: "Remove Bob" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Role of Bob")).toBeNull());
    expect(service.calls.removeMember).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "t1", userId: "bob" }),
    );
  });

  it("lets a member leave and returns to the list", async () => {
    const service = iamService([
      { id: "t2", name: "Support", members: [plain("alice"), admin("bob")] },
    ]);
    const { router } = render(service, "/teams/t2");
    fireEvent.click(await screen.findByRole("button", { name: "Leave team" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    expect(await screen.findByText(/aren't in a team yet/)).toBeTruthy();
  });

  it("renames a team", async () => {
    const service = iamService([{ id: "t1", name: "Platform", members: [admin("alice")] }]);
    render(service, "/teams/t1");
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Team name"), { target: { value: "Infra" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Infra" })).toBeTruthy();
    expect(service.calls.updateTeam).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1", name: "Infra" }),
    );
  });

  it("deletes a team after confirming", async () => {
    const service = iamService([{ id: "t1", name: "Platform", members: [admin("alice")] }]);
    const { router } = render(service, "/teams/t1");
    fireEvent.click(await screen.findByRole("button", { name: "Delete team" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    expect(service.calls.deleteTeam).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("treats a team the user isn't in as missing", async () => {
    render(iamService([{ id: "t3", name: "Hidden", members: [admin("bob")] }]), "/teams/t3");
    expect(await screen.findByText(/doesn't exist, or you aren't a member/)).toBeTruthy();
  });
});
