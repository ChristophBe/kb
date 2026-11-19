import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import {
  CurationService,
  LifecycleState,
} from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { IamService, TeamRole } from "@knowcel/iam-api/knowcel/iam/v1/iam_pb";
import { type CurrentUser, CurrentUserProvider } from "@knowcel/module-sdk";
import { renderWithRuntime } from "@knowcel/module-sdk/testing";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import LifecycleAction from "./LifecycleAction.tsx";
import LifecycleBadge from "./LifecycleBadge.tsx";
import LifecycleHistory from "./LifecycleHistory.tsx";

const alice: CurrentUser = {
  id: "alice",
  email: "a@x",
  displayName: "Alice",
  platformAdmin: false,
};
const bob: CurrentUser = { ...alice, id: "bob", email: "b@x", displayName: "Bob" };
const root: CurrentUser = { ...alice, id: "root", platformAdmin: true };

const approved = {
  state: LifecycleState.APPROVED,
  owner: "alice",
  reviewBy: { seconds: 1798761600n, nanos: 0 }, // 2027-01-01
};

interface Setup {
  states?: Record<string, object | undefined>;
  owner?: string;
  teamIds?: string[];
  myTeams?: { id: string; name: string; myRole: TeamRole }[];
  setLifecycle?: (request: object) => object;
  history?: object[];
}

function transport(s: Setup = {}) {
  const scoreChunks = vi.fn(({ documentIds }: { documentIds: string[] }) => ({
    scores: documentIds
      .filter((id) => s.states && id in s.states)
      .map((id) => ({ documentId: id, score: 0.5, lifecycle: s.states?.[id] })),
  }));
  const setLifecycle = vi.fn(s.setLifecycle ?? ((_request: object) => ({})));
  return {
    scoreChunks,
    setLifecycle,
    transport: createRouterTransport(({ service }) => {
      service(CurationService, {
        scoreChunks,
        setLifecycle,
        listLifecycleHistory: () => ({ changes: s.history ?? [] }),
      });
      service(DocumentService, {
        getDocument: ({ id }) => ({
          document: { id, ownerId: s.owner ?? "alice", teamIds: s.teamIds ?? [] },
        }),
      });
      service(IamService, {
        listMyTeams: () => ({ teams: s.myTeams ?? [] }),
        getTeam: () => ({
          team: { members: [{ userId: "carol", displayName: "Carol", email: "c@x" }] },
        }),
      });
    }),
  };
}

function render(ui: ReactNode, t: ReturnType<typeof transport>, user: CurrentUser | null = alice) {
  return renderWithRuntime(
    <CurrentUserProvider user={user}>{ui}</CurrentUserProvider>,
    t.transport,
  );
}

describe("LifecycleBadge", () => {
  it("shows the state as text, and nothing for a document without one", async () => {
    const t = transport({ states: { d1: { state: LifecycleState.DEPRECATED, owner: "alice" } } });
    render(
      <>
        <p>
          row 1 <LifecycleBadge documentId="d1" />
        </p>
        <p>
          row 2 <LifecycleBadge documentId="d2" />
        </p>
      </>,
      t,
    );
    expect(await screen.findByText("Deprecated")).toBeTruthy();
    expect(screen.getByText(/row 2/).textContent?.trim()).toBe("row 2");
  });

  it("asks for the documents of a whole list in one request", async () => {
    const t = transport({ states: {} });
    render(
      <>
        {["d1", "d2", "d3", "d4"].map((id) => (
          <LifecycleBadge key={id} documentId={id} />
        ))}
      </>,
      t,
    );
    await waitFor(() => expect(t.scoreChunks).toHaveBeenCalledTimes(1));
    expect(t.scoreChunks.mock.calls[0]?.[0].documentIds).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("shows nothing while the state can't be loaded", async () => {
    const t = transport();
    t.scoreChunks.mockImplementation(() => {
      throw new ConnectError("down", Code.Unavailable);
    });
    const { container } = render(<LifecycleBadge documentId="d1" />, t);
    await waitFor(() => expect(t.scoreChunks).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("LifecycleAction", () => {
  beforeAll(polyfillDialog);

  it("sets a state with a review date and a note", async () => {
    const t = transport({ states: { d1: approved } });
    const { container } = render(<LifecycleAction documentId="d1" />, t);
    expect(await screen.findByText("Approved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approval state" }));
    const dialog = await screen.findByRole("dialog", { name: "Approval state" });
    // It starts from the current state and date.
    expect(
      (within(dialog).getByRole("radio", { name: /Approved/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect((within(dialog).getByLabelText(/Review by/) as HTMLInputElement).value).toBe(
      "2027-01-01",
    );
    fireEvent.click(within(dialog).getByRole("radio", { name: /In review/ }));
    fireEvent.change(within(dialog).getByLabelText(/Review by/), {
      target: { value: "2027-03-15" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: " checking " } });
    await expectNoAxeViolations(container);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(t.setLifecycle).toHaveBeenCalledTimes(1));
    expect(t.setLifecycle.mock.calls[0]?.[0]).toMatchObject({
      documentId: "d1",
      state: LifecycleState.IN_REVIEW,
      note: "checking",
      reviewBy: { seconds: 1805068800n },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The button gets the focus back.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Approval state" }));
  });

  it("explains what deprecating does to chat before it is saved", async () => {
    const t = transport({ states: { d1: approved } });
    render(<LifecycleAction documentId="d1" />, t);
    fireEvent.click(await screen.findByRole("button", { name: "Approval state" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("note")).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Deprecated/ }));
    expect(within(dialog).getByRole("note").textContent).toContain(
      "Chat stops using this document",
    );
    expect(t.setLifecycle).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Deprecate document" }));
    await waitFor(() => expect(t.setLifecycle).toHaveBeenCalledTimes(1));
    expect(t.setLifecycle.mock.calls[0]?.[0]).toMatchObject({ state: LifecycleState.DEPRECATED });
  });

  it("asks to archive in so many words, and can't save without a state", async () => {
    const t = transport({ states: {} });
    render(<LifecycleAction documentId="d1" />, t);
    fireEvent.click(await screen.findByRole("button", { name: "Approval state" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      (within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: /Archived/ }));
    expect(within(dialog).getByRole("button", { name: "Archive document" })).toBeTruthy();
  });

  it("keeps the dialog open and says why when the service refuses", async () => {
    const setLifecycle = () => {
      throw new ConnectError("no", Code.PermissionDenied);
    };
    const t = transport({ states: { d1: approved }, setLifecycle });
    render(<LifecycleAction documentId="d1" />, t);
    fireEvent.click(await screen.findByRole("button", { name: "Approval state" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Draft/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText(/Only the owner, a team admin or a platform admin/),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it.each([
    ["the owner", alice, {}, true],
    ["someone else", bob, {}, false],
    ["a platform admin", root, {}, true],
    [
      "an admin of a team the document is shared with",
      bob,
      { teamIds: ["t1"], myTeams: [{ id: "t1", name: "T", myRole: TeamRole.ADMIN }] },
      true,
    ],
    [
      "a member of such a team",
      bob,
      { teamIds: ["t1"], myTeams: [{ id: "t1", name: "T", myRole: TeamRole.MEMBER }] },
      false,
    ],
    [
      "an admin of another team",
      bob,
      { teamIds: ["t1"], myTeams: [{ id: "t2", name: "T", myRole: TeamRole.ADMIN }] },
      false,
    ],
  ])("offers the button to %s: %s", async (_who, user, setup: Setup, enabled) => {
    render(<LifecycleAction documentId="d1" />, transport(setup), user);
    const button = (await screen.findByRole("button", {
      name: "Approval state",
    })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(!enabled));
    if (!enabled) {
      expect(button.getAttribute("title")).toMatch(/Only the owner/);
      expect(screen.getByText(/Only the owner, a team admin/)).toBeTruthy();
    }
  });
});

describe("LifecycleHistory", () => {
  const changes = [
    {
      lifecycle: { state: LifecycleState.DEPRECATED, owner: "alice" },
      note: "Replaced by the 2027 handbook",
      changedBy: "carol",
      changedAt: { seconds: 1798761600n, nanos: 0 },
    },
    {
      lifecycle: approved,
      note: "",
      changedBy: "alice",
      changedAt: { seconds: 1798000000n, nanos: 0 },
    },
  ];

  it("lists who changed the state, when, and why, newest first", async () => {
    const { container } = render(
      <LifecycleHistory documentId="d1" />,
      transport({
        history: changes,
        myTeams: [{ id: "t1", name: "T", myRole: TeamRole.MEMBER }],
      }),
    );
    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Deprecated");
    expect(items[0]?.textContent).toContain("Replaced by the 2027 handbook");
    await waitFor(() => expect(items[0]?.textContent).toContain("by Carol"));
    expect(items[1]?.textContent).toContain("by you");
    expect(items[1]?.textContent).toContain("Review by");
    expect(screen.getByRole("heading", { name: "Approval history" })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("shows nothing for a document that never had a state", async () => {
    const t = transport({ history: [] });
    const { container } = render(<LifecycleHistory documentId="d1" />, t);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("says so when the history can't be loaded", async () => {
    const t = transport();
    const failing = createRouterTransport(({ service }) =>
      service(CurationService, {
        listLifecycleHistory: () => {
          throw new ConnectError("down", Code.Unavailable);
        },
      }),
    );
    renderWithRuntime(<LifecycleHistory documentId="d1" />, failing);
    expect(
      await screen.findByText("Documents aren't available right now. Try again in a moment."),
    ).toBeTruthy();
    expect(t).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
