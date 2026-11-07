import { Code, ConnectError, KbRuntimeProvider } from "@kb/module-sdk";
import { badRequestDetail } from "@kb/ui/testing/errors";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TitleEditor } from "./TitleEditor.tsx";

const updateDocument = vi.fn();

vi.mock("@kb/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kb/module-sdk")>()),
  useClient: () => ({ updateDocument }),
}));

function renderEditor() {
  render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <TitleEditor id="d1" title="report.pdf" />
    </KbRuntimeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
  return screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
}

describe("TitleEditor", () => {
  beforeEach(() => {
    updateDocument.mockReset();
  });

  it("saves the trimmed title and returns focus to Edit title", async () => {
    updateDocument.mockResolvedValue({});
    const input = renderEditor();
    fireEvent.change(input, { target: { value: " Quarterly report " } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });
    expect(updateDocument).toHaveBeenCalledWith({ id: "d1", title: "Quarterly report" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit title" }));
  });

  it("keeps focus in the field for an empty title", () => {
    const input = renderEditor();
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(updateDocument).not.toHaveBeenCalled();
    expect(screen.getByText("Title must not be empty")).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("shows the server's message for the title next to the field", async () => {
    const err = new ConnectError(
      "Title must not be longer than 200 characters",
      Code.InvalidArgument,
    );
    err.details.push(
      badRequestDetail([
        { field: "title", description: "Title must not be longer than 200 characters" },
      ]),
    );
    updateDocument.mockRejectedValue(err);
    const input = renderEditor();
    fireEvent.change(input, { target: { value: "x".repeat(201) } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });
    const message = await screen.findByText("Title must not be longer than 200 characters");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(document.activeElement).toBe(input);
  });

  it("cancels with Escape", () => {
    fireEvent.keyDown(renderEditor(), { key: "Escape" });
    expect(screen.getByRole("heading", { name: "report.pdf" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit title" }));
  });
});
