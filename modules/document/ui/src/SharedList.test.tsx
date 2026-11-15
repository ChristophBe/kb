import { renderModule } from "@knowcel/module-sdk/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import documents from "./index.tsx";
import { ADMIN, alice, sharingService } from "./testing.ts";

const teams = [{ id: "t1", name: "Platform", role: ADMIN }];
const row = (title: string) => within(screen.getByRole("row", { name: new RegExp(title) }));

describe("DocumentList sharing", () => {
  it("names the teams a document is shared with", async () => {
    const { transport } = sharingService(
      [
        { id: "d1", title: "Notes", ownerId: "alice", teamIds: ["t1", "t9"] },
        { id: "d2", title: "Private", ownerId: "alice" },
      ],
      teams,
    );
    renderModule(documents, transport, "/", alice);
    await screen.findByRole("link", { name: "Notes" });
    await waitFor(() => expect(row("Notes").getByText("Platform")).toBeTruthy());
    // A team the owner is no longer in is shown without its name.
    expect(row("Notes").getByText("Another team")).toBeTruthy();
    expect(row("Private").queryByText("Platform")).toBeNull();
  });

  it("filters the documents others have shared with the user", async () => {
    const { transport } = sharingService(
      [
        { id: "d1", title: "Mine", ownerId: "alice" },
        { id: "d2", title: "Theirs", ownerId: "carol", teamIds: ["t1"] },
      ],
      teams,
    );
    renderModule(documents, transport, "/", alice);
    await screen.findByRole("link", { name: "Mine" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Shared with me" }));
    expect(screen.queryByRole("link", { name: "Mine" })).toBeNull();
    expect(screen.getByRole("link", { name: "Theirs" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shared with me" }));
    expect(screen.getByRole("link", { name: "Mine" })).toBeTruthy();
  });

  it("says so when nothing is shared with the user", async () => {
    const { transport } = sharingService([{ id: "d1", title: "Mine", ownerId: "alice" }], teams);
    renderModule(documents, transport, "/", alice);
    await screen.findByRole("link", { name: "Mine" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Shared with me" }));
    expect(screen.getByText("No documents have been shared with you.")).toBeTruthy();
  });

  it("badges a shared document as shared, without names, while IAM is down", async () => {
    const { transport } = sharingService(
      [{ id: "d1", title: "Notes", ownerId: "alice", teamIds: ["t1"] }],
      teams,
      { iam: false },
    );
    renderModule(documents, transport, "/", alice);
    await screen.findByRole("link", { name: "Notes" });
    expect(row("Notes").getByText("Shared")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
