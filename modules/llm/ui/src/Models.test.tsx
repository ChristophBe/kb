import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { LlmService, ModelKind } from "@kb/llm-api/kb/llm/v1/llm_pb";
import { renderModule } from "@kb/module-sdk/testing";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import llm from "./index.tsx";

describe("Models", () => {
  it("shows the provider status and the models", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getProviderStatus: () => ({
          provider: "ollama",
          healthy: true,
          detail: "ollama 0.12.6",
          defaultChatModel: "llama3.2",
          defaultEmbeddingModel: "nomic-embed-text",
          embeddingDimensions: 768,
        }),
        listModels: () => ({
          models: [
            { id: "llama3.2", provider: "ollama", kind: ModelKind.CHAT },
            { id: "nomic-embed-text", provider: "ollama", kind: ModelKind.EMBEDDING },
          ],
        }),
      }),
    );
    renderModule(llm, transport);
    expect(await screen.findByText("ollama 0.12.6")).toBeTruthy();
    expect(screen.getByText("healthy")).toBeTruthy();
    expect(screen.getByText("nomic-embed-text (768 dims)")).toBeTruthy();
    const models = within(await screen.findByRole("list"));
    const kinds = models.getAllByRole("listitem").map((li) => li.textContent);
    expect(kinds).toEqual(["llama3.2chat", "nomic-embed-textembedding"]);
  });

  it("shows why the provider can't be reached", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getProviderStatus: () => ({
          provider: "ollama",
          healthy: false,
          detail: "ollama unreachable",
        }),
        listModels: () => ({ models: [] }),
      }),
    );
    renderModule(llm, transport);
    expect(await screen.findByText("unavailable")).toBeTruthy();
    expect(screen.getByText("ollama unreachable")).toBeTruthy();
  });

  it("shows why the models can't be listed", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getProviderStatus: () => {
          throw new ConnectError("llm service down", Code.Unavailable);
        },
        listModels: () => {
          throw new ConnectError("llm service down", Code.Unavailable);
        },
      }),
    );
    renderModule(llm, transport);
    expect((await screen.findByRole("alert")).textContent).toBe("[unavailable] llm service down");
  });
});
