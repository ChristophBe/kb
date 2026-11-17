import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ConversationSchema,
  PromptTemplatesSchema,
} from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { CurrentUserProvider, KbRuntimeProvider, useQueryClient } from "@knowcel/module-sdk";
import { polyfillDialog } from "@knowcel/ui/testing/dialog";
import { badRequestDetail } from "@knowcel/ui/testing/errors";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor.tsx";

const updateConversation = vi.fn();
const updatePromptTemplates = vi.fn();
const getPromptTemplates = vi.fn();

vi.mock("@knowcel/module-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@knowcel/module-sdk")>()),
  useClient: () => ({ updateConversation, updatePromptTemplates, getPromptTemplates }),
}));

const ADMIN = { id: "root", email: "root@x", displayName: "Root", platformAdmin: true };
const MEMBER = { ...ADMIN, id: "mia", platformAdmin: false };

function templates(system = "Default system.") {
  const one = (content: string, defaultContent: string) => ({
    content,
    defaultContent,
    isDefault: content === defaultContent,
  });
  return {
    templates: create(PromptTemplatesSchema, {
      systemPrompt: one(system, "Default system."),
      sourcesTemplate: one("Sources:\n{sources}", "Sources:\n{sources}"),
      noSourcesTemplate: one("No sources.", "No sources."),
      variables: ["sources", "history"],
    }),
  };
}

// The runtime shares one query cache; each test starts with it empty.
let clearCache = () => {};
function Cache() {
  const client = useQueryClient();
  clearCache = () => client.clear();
  return null;
}

function renderEditor(user: typeof ADMIN | null, systemPrompt = "") {
  const conversation = create(ConversationSchema, { id: "c1", systemPrompt });
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }}>
      <Cache />
      <CurrentUserProvider user={user}>
        <PromptEditor conversation={conversation} />
      </CurrentUserProvider>
    </KbRuntimeProvider>,
  );
}

const dialog = () => within(screen.getByRole("dialog", { hidden: true }));
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
  await dialog().findByLabelText("System prompt");
};
const save = async () => {
  await act(async () => {
    fireEvent.click(dialog().getByRole("button", { name: "Save" }));
  });
};

describe("PromptEditor", () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    clearCache();
    updateConversation.mockReset().mockResolvedValue({});
    updatePromptTemplates.mockReset().mockResolvedValue({});
    getPromptTemplates.mockReset().mockResolvedValue(templates());
  });

  it("shows the default prompt and the available variables", async () => {
    renderEditor(MEMBER);
    await open();
    expect((dialog().getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe(
      "Default system.",
    );
    expect(dialog().getByText("{sources}")).toBeTruthy();
    expect(dialog().getAllByText("{history}").length).toBeGreaterThan(0);
  });

  it("saves the conversation's own prompt", async () => {
    renderEditor(MEMBER);
    await open();
    fireEvent.change(dialog().getByLabelText("System prompt"), {
      target: { value: "Be a pirate." },
    });
    await save();
    expect(updateConversation).toHaveBeenCalledWith({ id: "c1", systemPrompt: "Be a pirate." });
    expect(updatePromptTemplates).not.toHaveBeenCalled();
  });

  it("resets the prompt to the default, which follows the default again", async () => {
    renderEditor(MEMBER, "Be a pirate.");
    await open();
    expect((dialog().getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe(
      "Be a pirate.",
    );
    fireEvent.click(
      dialog().getAllByRole("button", { name: "Reset to default" })[0] as HTMLElement,
    );
    await save();
    expect(updateConversation).toHaveBeenCalledWith({ id: "c1", systemPrompt: "" });
  });

  it("shows a template error next to the field", async () => {
    const err = new ConnectError("invalid", Code.InvalidArgument);
    err.details.push(
      badRequestDetail([{ field: "system_prompt", description: "Unknown variable {nope}." }]),
    );
    updateConversation.mockRejectedValue(err);
    renderEditor(MEMBER);
    await open();
    fireEvent.change(dialog().getByLabelText("System prompt"), { target: { value: "{nope}" } });
    await save();
    expect(await dialog().findByText("Unknown variable {nope}.")).toBeTruthy();
    expect(dialog().getByLabelText("System prompt").getAttribute("aria-invalid")).toBe("true");
  });

  it("hides the defaults from everyone but platform admins", async () => {
    for (const user of [MEMBER, null]) {
      const { unmount } = renderEditor(user);
      await open();
      expect(dialog().queryByLabelText("Default system prompt")).toBeNull();
      expect(dialog().queryByText("Defaults for all conversations")).toBeNull();
      unmount();
    }
  });

  it("lets an admin change and reset the defaults", async () => {
    renderEditor(ADMIN);
    await open();
    fireEvent.change(dialog().getByLabelText("Default system prompt"), {
      target: { value: "Be formal." },
    });
    // Changed and reset again: nothing to send for it.
    fireEvent.change(dialog().getByLabelText("No-sources template"), { target: { value: "x" } });
    fireEvent.click(
      dialog().getAllByRole("button", { name: "Reset to default" })[3] as HTMLElement,
    );
    await save();
    expect(updatePromptTemplates).toHaveBeenCalledWith({ systemPrompt: "Be formal." });
  });

  it("resets a changed default to the built-in text", async () => {
    getPromptTemplates.mockResolvedValue(templates("Custom."));
    renderEditor(ADMIN);
    await open();
    expect((dialog().getByLabelText("Default system prompt") as HTMLTextAreaElement).value).toBe(
      "Custom.",
    );
    fireEvent.click(
      dialog().getAllByRole("button", { name: "Reset to default" })[1] as HTMLElement,
    );
    await save();
    expect(updatePromptTemplates).toHaveBeenCalledWith({ systemPrompt: "" });
  });

  it("shows an error of a default template next to its field", async () => {
    const err = new ConnectError("invalid", Code.InvalidArgument);
    err.details.push(
      badRequestDetail([
        { field: "sources_template", description: "The template must contain {sources}" },
      ]),
    );
    updatePromptTemplates.mockRejectedValue(err);
    renderEditor(ADMIN);
    await open();
    fireEvent.change(dialog().getByLabelText("Sources template"), { target: { value: "none" } });
    await save();
    expect(await dialog().findByText("The template must contain {sources}")).toBeTruthy();
  });

  it("shows a loading failure", async () => {
    getPromptTemplates.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    renderEditor(MEMBER);
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(await dialog().findByText(/couldn't be loaded/, {}, { timeout: 4000 })).toBeTruthy();
  });
});
