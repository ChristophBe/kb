import { Access } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { renderModule } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import documents from "./index.tsx";
import { ADMIN, alice, bob, MEMBER, sharingService } from "./testing.ts";

const teams = [
  { id: "t1", name: "Platform", role: ADMIN },
  { id: "t2", name: "Support", role: MEMBER },
];

async function sharedWithRow() {
  const term = await screen.findByText("Access", { selector: "dt" });
  return within(term.parentElement as HTMLElement);
}

describe("ShareEditor", () => {
  beforeAll(polyfillDialog);

  it("shows a public document as public, to its owner with a way to change it", async () => {
    const { transport } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "alice", access: Access.PUBLIC }],
      teams,
    );
    renderModule(documents, transport, "/d1", alice);
    const row = await sharedWithRow();
    expect(row.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change access" })).toBeTruthy();
  });

  it("lets the owner switch a document between public and team", async () => {
    const { transport, setDocumentAccess } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "alice", access: Access.PUBLIC }],
      teams,
    );
    const { container } = renderModule(documents, transport, "/d1", alice);
    await sharedWithRow();
    fireEvent.click(await screen.findByRole("button", { name: "Change access" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Change access" }));
    await expectNoAxeViolations(container);
    expect((dialog.getByRole("radio", { name: /Public/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(dialog.getByRole("radio", { name: /Team/ }));
    // A team document needs a team.
    expect(
      (dialog.getByRole("button", { name: "Save access" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(dialog.getByRole("checkbox", { name: "Platform" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Support" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(setDocumentAccess).toHaveBeenCalledTimes(1));
    expect(setDocumentAccess.mock.calls[0]?.[0]).toMatchObject({
      id: "d1",
      access: Access.TEAM,
      teamIds: ["t1", "t2"],
    });
    const row = await sharedWithRow();
    await waitFor(() => expect(row.getByText("Platform")).toBeTruthy());
    expect(row.getByText("Support")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change access" }));
    const again = within(await screen.findByRole("dialog", { name: "Change access" }));
    expect((again.getByRole("checkbox", { name: "Platform" }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(again.getByRole("radio", { name: /Public/ }));
    // Widening a team document to everyone asks first.
    fireEvent.click(again.getByRole("button", { name: "Save access" }));
    expect((await again.findByRole("alert")).textContent).toMatch(/Make this document public\?/);
    expect(setDocumentAccess).toHaveBeenCalledTimes(1);
    fireEvent.click(again.getByRole("button", { name: "Make public" }));
    await waitFor(() => expect(setDocumentAccess).toHaveBeenCalledTimes(2));
    expect(setDocumentAccess.mock.calls[1]?.[0]).toMatchObject({
      access: Access.PUBLIC,
      teamIds: [],
    });
    await waitFor(() => expect(row.getByText("Public")).toBeTruthy());
  });

  it("explains a team that isn't known yet, and saves on a second try", async () => {
    const { transport, setDocumentAccess } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "alice", access: Access.PUBLIC }],
      teams,
      { rejections: 1 },
    );
    renderModule(documents, transport, "/d1", alice);
    await sharedWithRow();
    fireEvent.click(await screen.findByRole("button", { name: "Change access" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Change access" }));
    fireEvent.click(dialog.getByRole("radio", { name: /Team/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Platform" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save access" }));
    expect((await dialog.findByRole("alert")).textContent).toMatch(/half a minute/);
    fireEvent.click(dialog.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(setDocumentAccess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers no access editor to anyone but the owner", async () => {
    const { transport } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "carol", access: Access.PUBLIC }],
      teams,
    );
    renderModule(documents, transport, "/d1", bob);
    const row = await sharedWithRow();
    await waitFor(() => expect(row.getByText("Public")).toBeTruthy());
    expect(row.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change access" })).toBeNull();
  });

  it("lets an admin of a team stop sharing with it, and only with it", async () => {
    const { transport, setDocumentTeams } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "carol", teamIds: ["t1", "t2"] }],
      teams,
    );
    renderModule(documents, transport, "/d1", bob);
    fireEvent.click(await (await sharedWithRow()).findByRole("button", { name: "Stop sharing" }));
    const dialog = within(
      await screen.findByRole("dialog", { name: "Stop sharing with your team" }),
    );
    // Support is a team bob is only a member of.
    expect((dialog.getByRole("checkbox", { name: "Support" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.click(dialog.getByRole("checkbox", { name: "Platform" }));
    fireEvent.click(dialog.getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(setDocumentTeams).toHaveBeenCalledTimes(1));
    expect(setDocumentTeams.mock.calls[0]?.[0]).toMatchObject({ teamIds: ["t2"] });
  });

  it("leaves the page of a document nobody on the user's teams can see any more", async () => {
    const { transport } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "carol", teamIds: ["t1"] }],
      teams,
    );
    renderModule(documents, transport, "/d1", bob);
    fireEvent.click(await (await sharedWithRow()).findByRole("button", { name: "Stop sharing" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Platform" }));
    fireEvent.click(dialog.getByRole("button", { name: "Stop sharing" }));
    expect(await screen.findByRole("table", { name: "Documents" })).toBeTruthy();
  });

  it("offers a plain member of a shared team no way to change it", async () => {
    const { transport } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "carol", teamIds: ["t2"] }],
      teams,
    );
    renderModule(documents, transport, "/d1", bob);
    const row = await sharedWithRow();
    await waitFor(() => expect(row.getByText("Support")).toBeTruthy());
    expect(row.queryByRole("button")).toBeNull();
  });

  it("without IAM names no teams, and the owner can still make the document public", async () => {
    const { transport } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "alice", teamIds: ["t1"] }],
      teams,
      { iam: false },
    );
    renderModule(documents, transport, "/d1", alice);
    const row = await sharedWithRow();
    expect(row.getByText("Team")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change access" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Change access" }));
    // The teams can't be looked up, but the document's own team is kept.
    expect((dialog.getByRole("radio", { name: /Public/ }) as HTMLInputElement).checked).toBe(false);
  });
});
