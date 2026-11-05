import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ConversationSchema } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { DocumentSchema } from "@kb/document-api/kb/document/v1/document_pb";
import { KbRuntimeProvider, useQueryClient, useToasts } from "@kb/module-sdk";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { polyfillDialog } from "@kb/ui/testing/dialog";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentPicker, describeScope, ScopeChips } from "./scope.tsx";

const updateConversation = vi.fn();
const getDocument = vi.fn();
const listDocuments = vi.fn();

// The real runtime, except that the chat and document clients are one fake.
vi.mock("@kb/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kb/module-sdk")>()),
  useClient: () => ({ updateConversation, getDocument, listDocuments }),
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

function renderScope(documentIds: string[]) {
  const conversation = create(ConversationSchema, { id: "c1", title: "Q3", documentIds });
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <FreshCache />
      <MemoryRouter>
        <ScopeChips conversation={conversation} />
        <DocumentPicker conversation={conversation} />
        <Toasts />
      </MemoryRouter>
    </KbRuntimeProvider>,
  );
}

const dialog = () => within(screen.getByRole("dialog", { hidden: true }));

describe("describeScope", () => {
  it("names the scope", () => {
    expect([0, 1, 2].map(describeScope)).toEqual(["all documents", "1 document", "2 documents"]);
  });
});

describe("ScopeChips", () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    updateConversation.mockReset();
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
    expect(screen.getByRole("button", { name: "Choose documents" })).toBeTruthy();
  });

  it("shows the scoped documents as links, and deleted ones as such", async () => {
    const { container } = renderScope(["d1", "gone"]);
    const chips = within(await screen.findByRole("list", { name: "Scope:" }));
    const link = await chips.findByRole("link", { name: "Quarterly report.pdf" });
    expect(link.getAttribute("href")).toBe("/m/document/d1");
    expect(chips.getByRole("link", { name: "Deleted document" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Documents (2)" })).toBeTruthy();
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

describe("DocumentPicker", () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    updateConversation.mockReset();
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
    const group = within(await openPicker("Documents (1)"));
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
    });
    expect(screen.getByText("Scope changed to 2 documents")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Documents (1)" }));
  });

  it("clears the scope when nothing is selected", async () => {
    updateConversation.mockResolvedValue({});
    renderScope(["d2"]);
    const group = within(await openPicker("Documents (1)"));
    fireEvent.click(group.getByRole("checkbox", { name: "Board minutes.md" }));
    await act(async () => {
      fireEvent.click(dialog().getByRole("button", { name: "Apply" }));
    });
    expect(updateConversation).toHaveBeenCalledWith({ id: "c1", documentIds: { ids: [] } });
    expect(screen.getByText("Scope changed to all documents")).toBeTruthy();
  });

  it("cancels without changing the scope", async () => {
    renderScope([]);
    const group = within(await openPicker("Choose documents"));
    fireEvent.click(group.getByRole("checkbox", { name: "Board minutes.md" }));
    fireEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(updateConversation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Choose documents" }));
  });

  it("explains when the documents can't be listed", async () => {
    listDocuments.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    renderScope([]);
    fireEvent.click(screen.getByRole("button", { name: "Choose documents" }));
    expect((await dialog().findByRole("alert")).textContent).toBe(
      "The Documents service isn't available. Try again later.",
    );
  });
});
