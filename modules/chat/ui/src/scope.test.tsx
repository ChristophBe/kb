import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { type Conversation, ConversationSchema } from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { DocumentSchema } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { KbRuntimeProvider, useQueryClient, useToasts } from "@knowcel/module-sdk";
import { expectNoAxeViolations } from "@knowcel/ui/testing";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeScope, ScopeChips, SourcesControl } from "./scope.tsx";

const updateConversation = vi.fn();
const getDocument = vi.fn();
const listDocuments = vi.fn();
const listMyTeams = vi.fn();

// The real runtime, except that the chat and document clients are one fake.
vi.mock("@knowcel/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@knowcel/module-sdk")>()),
  useClient: () => ({ updateConversation, getDocument, listDocuments, listMyTeams }),
}));

const DOCS = [
  create(DocumentSchema, { id: "d1", title: "Quarterly report.pdf" }),
  create(DocumentSchema, { id: "d2", title: "Board minutes.md" }),
  create(DocumentSchema, { id: "d3", title: "", filename: "onboarding.md" }),
];

function Toasts() {
  return (
    <ul aria-label="Toasts">
      {useToasts().map((t) => (
        <li key={t.id}>{t.message}</li>
      ))}
    </ul>
  );
}

/** The runtime's query cache is shared by all tests; each test starts empty, without retries. */
function FreshCache() {
  const client = useQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  clearCache = () => client.clear();
  return null;
}
let clearCache = () => {};
afterEach(() => clearCache());

const onKnowledge = vi.fn();

/** Holds the platform-knowledge choice like Conversation does. */
function Sources({ conversation }: { conversation: Conversation }) {
  const [on, setOn] = useState(true);
  return (
    <>
      <ScopeChips conversation={conversation} useKnowledgeBase={on} />
      <SourcesControl
        conversation={conversation}
        useKnowledgeBase={on}
        onUseKnowledgeBaseChange={(v) => {
          onKnowledge(v);
          setOn(v);
        }}
      />
    </>
  );
}

function renderScope(documentIds: string[], teamIds: string[] = []) {
  const conversation = create(ConversationSchema, {
    id: "c1",
    title: "Q3",
    documentIds,
    teamIds,
  });
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <FreshCache />
      <MemoryRouter>
        <Sources conversation={conversation} />
        <Toasts />
      </MemoryRouter>
    </KbRuntimeProvider>,
  );
}

const dialog = () => within(screen.getByRole("dialog", { hidden: true }));

describe("describeScope", () => {
  it("names the scope", () => {
    expect([0, 1, 2].map((n) => describeScope(n))).toEqual([
      "all documents",
      "1 document",
      "2 documents",
    ]);
  });

  it("names the teams of the scope", () => {
    expect(describeScope(0, ["Platform"])).toBe("documents of team Platform");
    expect(describeScope(0, ["Platform", "Support"])).toBe("documents of teams Platform, Support");
    expect(describeScope(2, ["Platform"])).toBe("2 documents of team Platform");
  });
});

describe("ScopeChips", () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    updateConversation.mockReset();
    onKnowledge.mockReset();
    getDocument.mockReset();
    listDocuments.mockReset();
    getDocument.mockImplementation(async ({ id }: { id: string }) => {
      const document = DOCS.find((d) => d.id === id);
      if (!document) throw new ConnectError("not found", Code.NotFound);
      return { document };
    });
    listDocuments.mockResolvedValue({ documents: DOCS });
  });

  it("says all documents without a scope", () => {
    renderScope([]);
    expect(screen.getByText("all documents")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sources" })).toBeTruthy();
  });

  it("shows the scoped documents as links, and deleted ones as such", async () => {
    const { container } = renderScope(["d1", "gone"]);
    const chips = within(await screen.findByRole("list", { name: "Scope:" }));
    const link = await chips.findByRole("link", { name: "Quarterly report.pdf" });
    expect(link.getAttribute("href")).toBe("/m/document/d1");
    expect(chips.getByRole("link", { name: "Deleted document" })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("removes a document from the scope and focuses the next chip", async () => {
    updateConversation.mockResolvedValue({});
    renderScope(["d1", "d2"]);
    const remove = await screen.findByRole("button", {
      name: "Remove Quarterly report.pdf from scope",
    });
    await act(async () => {
      fireEvent.click(remove);
    });

    expect(updateConversation).toHaveBeenCalledWith({ id: "c1", documentIds: { ids: ["d2"] } });
    expect(screen.getByText("Scope changed to 1 document")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Board minutes.md" }));
  });
});

describe("SourcesControl documents", () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    updateConversation.mockReset();
    onKnowledge.mockReset();
    getDocument.mockReset();
    listDocuments.mockReset();
    getDocument.mockImplementation(async ({ id }: { id: string }) => ({
      document: DOCS.find((d) => d.id === id),
    }));
    listDocuments.mockResolvedValue({ documents: DOCS });
  });

  async function openPicker(name: string) {
    fireEvent.click(screen.getByRole("button", { name }));
    return await dialog().findByRole("group", { name: "Documents" });
  }

  it("selects documents, filters by title and applies the scope", async () => {
    updateConversation.mockResolvedValue({});
    renderScope(["d1"]);
    const group = within(await openPicker("Sources"));
    expect(
      (group.getByRole("checkbox", { name: "Quarterly report.pdf" }) as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.change(dialog().getByRole("searchbox", { name: "Search documents" }), {
      target: { value: "onboard" },
    });
    expect(group.queryByRole("checkbox", { name: "Board minutes.md" })).toBeNull();
    fireEvent.click(group.getByRole("checkbox", { name: "onboarding.md" }));
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Apply" }));
    });

    expect(updateConversation).toHaveBeenCalledWith({
      id: "c1",
      documentIds: { ids: ["d1", "d3"] },
      teamIds: { ids: [] },
    });
    expect(screen.getByText("Sources changed to 2 documents")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sources" }));
  });

  it("clears the scope when nothing is selected", async () => {
    updateConversation.mockResolvedValue({});
    renderScope(["d2"]);
    const group = within(await openPicker("Sources"));
    fireEvent.click(group.getByRole("checkbox", { name: "Board minutes.md" }));
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Apply" }));
    });
    expect(updateConversation).toHaveBeenCalledWith({
      id: "c1",
      documentIds: { ids: [] },
      teamIds: { ids: [] },
    });
    expect(screen.getByText("Sources changed to all documents")).toBeTruthy();
  });

  it("turns platform knowledge off, disabling the lists, and on again", async () => {
    updateConversation.mockResolvedValue({});
    renderScope(["d1"]);
    const group = within(await openPicker("Sources"));
    const toggle = dialog().getByRole("checkbox", { name: "Use platform knowledge" });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(
      dialog().getByText(
        "Answers are based on the documents and teams you can access in Knowcelium.",
      ),
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(group.getByRole("checkbox", { name: "Board minutes.md" }).matches(":disabled")).toBe(
      true,
    );
    expect(
      (dialog().getByRole("searchbox", { name: "Search documents" }) as HTMLInputElement).disabled,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Apply" }));
    });
    expect(onKnowledge).toHaveBeenLastCalledWith(false);
    expect(updateConversation).not.toHaveBeenCalled();
    expect(screen.getByText("No platform knowledge – model only")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Scope:" })).toBeNull();

    await openPicker("Sources");
    fireEvent.click(dialog().getByRole("checkbox", { name: "Use platform knowledge" }));
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Apply" }));
    });
    expect(onKnowledge).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText("No platform knowledge – model only")).toBeNull();
  });

  it("cancels without changing the scope", async () => {
    renderScope([]);
    const group = within(await openPicker("Sources"));
    fireEvent.click(group.getByRole("checkbox", { name: "Board minutes.md" }));
    fireEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(updateConversation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sources" }));
  });

  it("explains when the documents can't be listed", async () => {
    listDocuments.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    renderScope([]);
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect((await dialog().findByRole("alert")).textContent).toBe(
      "The Documents service isn't available. Try again later.",
    );
  });
});

const teamlessDialog = dialog;
const teamDialog = () =>
  within(screen.getByRole("dialog", { name: "Sources for this chat", hidden: true }));

describe("SourcesControl teams", () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    updateConversation.mockReset();
    onKnowledge.mockReset();
    getDocument.mockReset();
    listDocuments.mockReset();
    listMyTeams.mockReset();
    listMyTeams.mockResolvedValue({
      teams: [
        { id: "t1", name: "Platform" },
        { id: "t2", name: "Support" },
      ],
    });
  });

  it("uses all documents by default, with the teams to choose from", async () => {
    renderScope([]);
    expect(screen.getByText("all documents")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Sources" }));
    const group = within(await teamDialog().findByRole("group", { name: "Use documents of" }));
    expect(group.getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked)).toEqual([
      false,
      false,
    ]);
  });

  it("limits the answers to the chosen teams, and names them", async () => {
    updateConversation.mockResolvedValue({});
    renderScope([]);
    fireEvent.click(await screen.findByRole("button", { name: "Sources" }));
    const group = within(await teamDialog().findByRole("group", { name: "Use documents of" }));
    fireEvent.click(group.getByRole("checkbox", { name: "Platform" }));
    fireEvent.click(group.getByRole("checkbox", { name: "Support" }));
    await act(async () => {
      fireEvent.click(teamDialog().getByRole("button", { name: "Apply" }));
    });
    expect(updateConversation).toHaveBeenCalledWith({
      id: "c1",
      documentIds: { ids: [] },
      teamIds: { ids: ["t1", "t2"] },
    });
    expect(
      screen.getByText("Sources changed to documents of teams Platform, Support"),
    ).toBeTruthy();
  });

  it("shows the teams of the conversation in the header and lets them be cleared", async () => {
    updateConversation.mockResolvedValue({});
    renderScope([], ["t2"]);
    expect(await screen.findByText("Support")).toBeTruthy();
    expect(screen.queryByText("all documents")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    const group = within(await teamDialog().findByRole("group", { name: "Use documents of" }));
    expect((group.getByRole("checkbox", { name: "Support" }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(group.getByRole("checkbox", { name: "Support" }));
    await act(async () => {
      fireEvent.click(teamDialog().getByRole("button", { name: "Apply" }));
    });
    expect(updateConversation).toHaveBeenCalledWith({
      id: "c1",
      documentIds: { ids: [] },
      teamIds: { ids: [] },
    });
  });

  it("falls back to all documents when the teams are gone", async () => {
    renderScope([], ["deleted-team"]);
    await screen.findByRole("button", { name: "Sources" });
    expect(screen.getByText("all documents")).toBeTruthy();
  });

  it("explains a team the server doesn't accept", async () => {
    updateConversation.mockRejectedValue(new ConnectError("no", Code.PermissionDenied));
    renderScope([]);
    fireEvent.click(await screen.findByRole("button", { name: "Sources" }));
    const group = within(await teamDialog().findByRole("group", { name: "Use documents of" }));
    fireEvent.click(group.getByRole("checkbox", { name: "Platform" }));
    await act(async () => {
      fireEvent.click(teamDialog().getByRole("button", { name: "Apply" }));
    });
    expect(await screen.findByText(/You're not a member of one of the teams/)).toBeTruthy();
  });

  it("offers no team choice without teams", async () => {
    listMyTeams.mockResolvedValue({ teams: [] });
    listDocuments.mockResolvedValue({ documents: DOCS });
    renderScope([]);
    await screen.findByText("all documents");
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    await teamlessDialog().findByRole("group", { name: "Documents" });
    expect(teamlessDialog().queryByRole("group", { name: "Use documents of" })).toBeNull();
  });

  it("applies documents and teams in one request", async () => {
    updateConversation.mockResolvedValue({});
    listDocuments.mockResolvedValue({ documents: DOCS });
    renderScope([]);
    fireEvent.click(await screen.findByRole("button", { name: "Sources" }));
    const docs = within(await teamDialog().findByRole("group", { name: "Documents" }));
    fireEvent.click(await docs.findByRole("checkbox", { name: "Board minutes.md" }));
    const teams = within(await teamDialog().findByRole("group", { name: "Use documents of" }));
    fireEvent.click(teams.getByRole("checkbox", { name: "Platform" }));
    await act(async () => {
      fireEvent.click(teamDialog().getByRole("button", { name: "Apply" }));
    });
    expect(updateConversation).toHaveBeenCalledTimes(1);
    expect(updateConversation).toHaveBeenCalledWith({
      id: "c1",
      documentIds: { ids: ["d2"] },
      teamIds: { ids: ["t1"] },
    });
  });
});
