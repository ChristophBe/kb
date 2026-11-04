import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ConversationSchema } from "@kb/chat-api/kb/chat/v1/chat_pb";
import { KbRuntimeProvider, useToasts } from "@kb/module-sdk";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationHeader } from "./ConversationHeader.tsx";

const updateConversation = vi.fn();

// The real runtime, except that the chat client is a fake.
vi.mock("@kb/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kb/module-sdk")>()),
  useClient: () => ({ updateConversation }),
}));

function Toasts() {
  return (
    <ul>
      {useToasts().map((t) => (
        <li key={t.id}>{t.message}</li>
      ))}
    </ul>
  );
}

function renderHeader(title = "Q3 revenue") {
  const conversation = create(ConversationSchema, { id: "c1", title });
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <ConversationHeader conversation={conversation} />
      <Toasts />
    </KbRuntimeProvider>,
  );
}

function startRename() {
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  return screen.getByRole("textbox", { name: "Conversation title" }) as HTMLInputElement;
}

describe("ConversationHeader", () => {
  beforeEach(() => {
    updateConversation.mockReset();
  });

  it("shows the title, or a placeholder without one", () => {
    renderHeader("");
    expect(screen.getByRole("heading", { name: "New conversation" })).toBeTruthy();
  });

  it("saves a new title with Enter and returns focus to Rename", async () => {
    updateConversation.mockResolvedValue({});
    renderHeader();
    const input = startRename();
    expect(input.value).toBe("Q3 revenue");

    fireEvent.change(input, { target: { value: "  Q4 plans " } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });

    expect(updateConversation).toHaveBeenCalledWith({ id: "c1", title: "Q4 plans" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByText("Conversation renamed")).toBeTruthy();
  });

  it("rejects an empty title without calling the server", () => {
    renderHeader();
    const input = startRename();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(updateConversation).not.toHaveBeenCalled();
    expect(screen.getByText("Title must not be empty")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the server's reason next to the field", async () => {
    updateConversation.mockRejectedValue(
      new ConnectError("title must not be longer than 200 characters", Code.InvalidArgument),
    );
    renderHeader();
    const input = startRename();
    fireEvent.change(input, { target: { value: "too long" } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });

    expect(screen.getByText("title must not be longer than 200 characters")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("cancels with Escape", () => {
    renderHeader();
    fireEvent.keyDown(startRename(), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(updateConversation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename" }));
  });
});
