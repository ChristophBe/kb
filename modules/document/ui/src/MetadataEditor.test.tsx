import { Code, ConnectError } from "@connectrpc/connect";
import { KbRuntimeProvider } from "@kb/module-sdk";
import { polyfillDialog } from "@kb/ui/testing/dialog";
import { badRequestDetail } from "@kb/ui/testing/errors";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataEditor, validate } from "./MetadataEditor.tsx";

const updateDocument = vi.fn();

vi.mock("@kb/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kb/module-sdk")>()),
  useClient: () => ({ updateDocument }),
}));

function renderEditor(metadata: Record<string, string> = { year: "2026", source: "finance" }) {
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <MetadataEditor id="d1" metadata={metadata} />
    </KbRuntimeProvider>,
  );
}

const dialog = () => within(screen.getByRole("dialog", { hidden: true }));
const keys = () => dialog().getAllByRole("textbox", { name: "Key" }) as HTMLInputElement[];
const values = () => dialog().getAllByRole("textbox", { name: "Value" }) as HTMLInputElement[];
const save = async () => {
  await act(async () => {
    fireEvent.click(dialog().getByRole("button", { name: "Save" }));
  });
};

describe("validate", () => {
  const rows = (...pairs: [string, string][]) =>
    pairs.map(([key, value], id) => ({ id, key, value }));

  it("accepts distinct keys and ignores empty rows", () => {
    expect(validate(rows(["a", "1"], ["b", ""], ["", ""])).size).toBe(0);
  });

  it("rejects an empty key with a value and a duplicate key", () => {
    const errors = validate(rows(["a", "1"], ["", "orphan"], [" a ", "2"]));
    expect(errors.get(1)).toBe("Key must not be empty");
    expect(errors.get(2)).toBe('Key "a" is used twice');
  });
});

describe("MetadataEditor", () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    updateDocument.mockReset();
  });

  it("lists the metadata sorted by key", () => {
    renderEditor();
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual(["source", "year"]);
  });

  it("edits, adds and saves fields", async () => {
    updateDocument.mockResolvedValue({});
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    expect(keys().map((k) => k.value)).toEqual(["source", "year", ""]);

    fireEvent.change(values()[1] as HTMLInputElement, { target: { value: "2027" } });
    fireEvent.change(keys()[2] as HTMLInputElement, { target: { value: "owner" } });
    fireEvent.change(values()[2] as HTMLInputElement, { target: { value: "me" } });
    await save();

    expect(updateDocument).toHaveBeenCalledWith({
      id: "d1",
      metadata: { source: "finance", year: "2027", owner: "me" },
      setMetadata: true,
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit metadata" }));
  });

  it("shows errors next to the rows and focuses the first invalid key", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    fireEvent.change(keys()[2] as HTMLInputElement, { target: { value: "year" } });
    await save();

    expect(updateDocument).not.toHaveBeenCalled();
    expect(dialog().getByText('Key "year" is used twice')).toBeTruthy();
    expect(document.activeElement).toBe(keys()[2]);
    expect(keys()[2]?.getAttribute("aria-invalid")).toBe("true");
  });

  it("removes a field and moves focus to the next key, or to Add field", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    fireEvent.click(dialog().getByRole("button", { name: "Remove source" }));
    expect(keys().map((k) => k.value)).toEqual(["year", ""]);
    expect(document.activeElement).toBe(keys()[0]);

    fireEvent.click(dialog().getByRole("button", { name: "Remove field 2" }));
    expect(document.activeElement).toBe(dialog().getByRole("button", { name: "Add field" }));
  });

  it("adds a row and focuses its key", () => {
    renderEditor({});
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    fireEvent.click(dialog().getByRole("button", { name: "Add field" }));
    expect(keys()).toHaveLength(2);
    expect(document.activeElement).toBe(keys()[1]);
  });

  it("shows a server error in the dialog", async () => {
    updateDocument.mockRejectedValue(
      new ConnectError("metadata keys must not be empty", Code.InvalidArgument),
    );
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    await save();
    const alert = await dialog().findByRole("alert");
    expect(alert.textContent).toBe("metadata keys must not be empty");
  });

  it("shows the server's field violations in the dialog", async () => {
    const err = new ConnectError("Metadata keys must not be empty", Code.InvalidArgument);
    err.details.push(
      badRequestDetail([{ field: "metadata", description: "Metadata keys must not be empty" }]),
    );
    updateDocument.mockRejectedValue(err);
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    await save();
    const alert = await dialog().findByRole("alert");
    expect(alert.textContent).toBe("Metadata keys must not be empty");
  });
});
