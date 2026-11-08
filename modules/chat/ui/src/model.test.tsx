import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { LlmService, ModelKind } from "@kb/llm-api/kb/llm/v1/llm_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { MessageSquare } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPicker, useModelChoice } from "./model.tsx";

const ollama = createRouterTransport(({ service }) =>
  service(LlmService, {
    getProviderStatus: () => ({ defaultChatModel: "llama3.2" }),
    listModels: () => ({
      models: [
        { id: "qwen2.5:0.5b", provider: "ollama", kind: ModelKind.CHAT },
        { id: "nomic-embed-text", provider: "ollama", kind: ModelKind.EMBEDDING },
        { id: "llama3.2", provider: "ollama", kind: ModelKind.CHAT },
      ],
    }),
  }),
);

function Probe({ conversationId }: { conversationId: string }) {
  const choice = useModelChoice(conversationId);
  if (!choice) return <p>no picker</p>;
  return (
    <>
      <ModelPicker choice={choice} disabled={false} />
      <output>{`sent: ${choice.model || "(default)"}`}</output>
    </>
  );
}

/** Renders the picker of a conversation, with a fresh query cache. */
function renderProbe(conversationId: string, transport = ollama) {
  const probe = {
    id: "probe",
    title: "Probe",
    icon: MessageSquare,
    routes: [{ path: "/", element: <Probe conversationId={conversationId} /> }],
  };
  return renderModule(probe, transport);
}

describe("useModelChoice", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("offers the chat models, the llm default first and selected", async () => {
    renderProbe("c1");
    const select = (await screen.findByRole("combobox", { name: "Model" })) as HTMLSelectElement;
    const options = [...select.options].map((o) => o.textContent);
    expect(options).toEqual(["llama3.2 (default)", "qwen2.5:0.5b"]);
    expect(select.value).toBe("llama3.2");
    expect(screen.getByText("sent: (default)")).toBeTruthy();
  });

  it("remembers the pick per conversation", async () => {
    renderProbe("c1");
    fireEvent.change(await screen.findByRole("combobox", { name: "Model" }), {
      target: { value: "qwen2.5:0.5b" },
    });
    expect(screen.getByText("sent: qwen2.5:0.5b")).toBeTruthy();
    cleanup();

    renderProbe("c1");
    expect(await screen.findByText("sent: qwen2.5:0.5b")).toBeTruthy();
    cleanup();

    renderProbe("c2");
    expect(await screen.findByText("sent: (default)")).toBeTruthy();
  });

  it("falls back to the default when the picked model is gone", async () => {
    localStorage.setItem("kb.chat.model.c1", "mistral");
    renderProbe("c1");
    const select = (await screen.findByRole("combobox", { name: "Model" })) as HTMLSelectElement;
    expect(select.value).toBe("llama3.2");
    expect(screen.getByText("sent: (default)")).toBeTruthy();
  });

  it("hides the picker while the llm module is unavailable", async () => {
    const listModels = vi.fn(() => {
      throw new ConnectError("down", Code.Unavailable);
    });
    const down = createRouterTransport(({ service }) =>
      service(LlmService, { getProviderStatus: () => ({}), listModels }),
    );
    renderProbe("c1", down);
    await vi.waitFor(() => expect(listModels).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByText("no picker")).toBeTruthy();
  });
});
