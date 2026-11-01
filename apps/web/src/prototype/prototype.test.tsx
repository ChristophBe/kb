import { expectNoAxeViolations } from "@kb/ui/testing";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";
import { Prototype } from "./index.tsx";

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  Element.prototype.scrollIntoView = () => {};
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="prototype/*" element={<Prototype />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("every prototype screen renders without axe violations", () => {
  it.each([
    ["/prototype", "M1 prototype"],
    ["/prototype/documents", "Documents"],
    ["/prototype/documents/d1", "Quarterly report Q3"],
    ["/prototype/search?q=revenue", "Search"],
    ["/prototype/ingestion", "Ingestion"],
    ["/prototype/chat/c1", "Q3 revenue questions"],
    ["/prototype/shell", "Shell states"],
  ])("%s", async (path, heading) => {
    const { container } = renderAt(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

describe("prototype flows", () => {
  it("shows every state of the document list", async () => {
    renderAt("/prototype/documents");
    expect(await screen.findByRole("link", { name: "Quarterly report Q3" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Empty" }));
    expect(await screen.findByText(/No documents yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Service unavailable" }));
    expect(await screen.findByText(/The document service isn't available/)).toBeTruthy();
  });

  it("validates and saves a title", async () => {
    renderAt("/prototype/documents/d1");
    fireEvent.click(await screen.findByRole("button", { name: "Edit title" }));
    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Title must not be empty")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Q3 report" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Q3 report" })).toBeTruthy();
  });

  it("rejects duplicate metadata keys", async () => {
    renderAt("/prototype/documents/d1");
    fireEvent.click(await screen.findByRole("button", { name: "Edit metadata" }));
    const dialog = screen.getByRole("dialog", { name: "Edit metadata" });
    const keys = within(dialog).getAllByRole("textbox", { name: "Key" });
    fireEvent.change(keys[1] as HTMLElement, { target: { value: "source" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText('Key "source" is used twice')).toBeTruthy();
  });

  it("deletes a document after confirmation and offers undo", async () => {
    renderAt("/prototype/documents");
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Board minutes October" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
    expect(screen.queryByRole("link", { name: "Board minutes October" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Undo delete" }));
    expect(await screen.findByRole("link", { name: "Board minutes October" })).toBeTruthy();
  });

  it("puts sources in the margin and links them to their markers", async () => {
    renderAt("/prototype/chat/c1");
    const [first] = await screen.findAllByRole("list", { name: "Sources" });
    const note = within(first as HTMLElement).getByRole("link", {
      name: "Quarterly report Q3, chunk 1",
    });
    expect(note.closest("li")?.className).not.toContain("border-accent");
    const marker = screen.getAllByRole("link", { name: /^Source 1: / })[0] as HTMLElement;
    fireEvent.mouseEnter(marker);
    expect(note.closest("li")?.className).toContain("border-accent");
    fireEvent.mouseLeave(marker);
    expect(note.closest("li")?.className).not.toContain("border-accent");
  });

  it("streams a cited answer and can stop one", async () => {
    renderAt("/prototype/chat/c2");
    const composer = await screen.findByRole("textbox", { name: "Ask a question" });
    fireEvent.change(composer, { target: { value: "What about revenue growth?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy();
    expect(
      await screen.findByRole("link", { name: /^Source 1: / }, { timeout: 5000 }),
    ).toBeTruthy();
    expect(await screen.findByText("Answer ready", {}, { timeout: 5000 })).toBeTruthy();

    fireEvent.change(composer, { target: { value: "And churn?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByRole("button", { name: "Stop" });
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(await screen.findByText("Stopped")).toBeTruthy();
  });

  it("rejects unsupported uploads before uploading", async () => {
    const { container } = renderAt("/prototype/ingestion");
    await screen.findByRole("button", { name: "Choose files" });
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["x"], "slides.pptx")] },
    });
    expect(await screen.findByText(/Not supported/)).toBeTruthy();
  });
});
