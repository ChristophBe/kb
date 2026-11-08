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
    // An older server sends no chat/embedding: both rows show the one provider.
    expect(screen.getAllByText("healthy")).toHaveLength(2);
    expect(screen.getByText("nomic-embed-text (768 dims)")).toBeTruthy();
    const models = within(await screen.findByRole("list"));
    const kinds = models.getAllByRole("listitem").map((li) => li.textContent);
    expect(kinds).toEqual(["llama3.2ollamachat", "nomic-embed-textollamaembedding"]);
  });

  it("shows the chat and the embedding provider separately", async () => {
    const transport = createRouterTransport(({ service }) =>
      service(LlmService, {
        getProviderStatus: () => ({
          provider: "anthropic+ollama",
          healthy: false,
          detail: "chat: anthropic unavailable; embedding: ollama 0.12.6",
          defaultChatModel: "claude-sonnet-5-5",
          defaultEmbeddingModel: "nomic-embed-text",
          embeddingDimensions: 768,
          chat: { provider: "anthropic", healthy: false, detail: "anthropic unavailable" },
          embedding: { provider: "ollama", healthy: true, detail: "ollama 0.12.6" },
        }),
        listModels: () => ({
          models: [
            { id: "claude-sonnet-5-5", provider: "anthropic", kind: ModelKind.CHAT },
            { id: "nomic-embed-text", provider: "ollama", kind: ModelKind.EMBEDDING },
          ],
        }),
      }),
    );
    renderModule(llm, transport);
    const chat = (await screen.findByText("Chat provider")).nextElementSibling;
    expect(chat?.textContent).toBe("anthropicunavailable");
    const embedding = screen.getByText("Embedding provider").nextElementSibling;
    expect(embedding?.textContent).toBe("ollamahealthy");
    expect(
      screen.getByText("claude-sonnet-5-5", { selector: "span:not(.font-mono)" }),
    ).toBeTruthy();
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
    expect(await screen.findAllByText("unavailable")).toHaveLength(2);
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
