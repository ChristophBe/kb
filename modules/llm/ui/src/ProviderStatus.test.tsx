import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { LlmService } from "@kb/llm-api/kb/llm/v1/llm_pb";
import { renderWidget } from "@kb/module-sdk/testing";
import { expectNoAxeViolations } from "@kb/ui/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderStatus } from "./ProviderStatus.tsx";

function rows() {
  return screen.getAllByRole("listitem").map((li) => li.textContent);
}

describe("ProviderStatus", () => {
  it("shows the chat and the embedding provider separately", async () => {
    const { container } = renderWidget(
      ProviderStatus,
      createRouterTransport(({ service }) =>
        service(LlmService, {
          getProviderStatus: () => ({
            provider: "anthropic+ollama",
            healthy: false,
            defaultChatModel: "claude-sonnet-5-5",
            defaultEmbeddingModel: "nomic-embed-text",
            chat: { provider: "anthropic", healthy: false, detail: "anthropic unavailable" },
            embedding: { provider: "ollama", healthy: true, detail: "ollama 0.12.6" },
          }),
        }),
      ),
    );
    await screen.findByText("anthropic");
    expect(rows()).toEqual([
      "Chatanthropicclaude-sonnet-5-5unavailable",
      "Embeddingollamanomic-embed-texthealthy",
    ]);
    expect(screen.getByRole("link", { name: "View models" }).getAttribute("href")).toBe("/m/llm");
    await expectNoAxeViolations(container);
  });

  it("shows the one provider of an older server for both", async () => {
    renderWidget(
      ProviderStatus,
      createRouterTransport(({ service }) =>
        service(LlmService, {
          getProviderStatus: () => ({
            provider: "ollama",
            healthy: true,
            defaultChatModel: "llama3.2",
            defaultEmbeddingModel: "nomic-embed-text",
          }),
        }),
      ),
    );
    await screen.findByText("llama3.2");
    expect(rows()).toEqual(["Chatollamallama3.2healthy", "Embeddingollamanomic-embed-texthealthy"]);
  });

  it("stays calm while the service is down", async () => {
    renderWidget(
      ProviderStatus,
      createRouterTransport(({ service }) =>
        service(LlmService, {
          getProviderStatus: () => {
            throw new ConnectError("no healthy upstream", Code.Unavailable);
          },
        }),
      ),
    );
    expect(await screen.findByText("The providers can't be checked right now.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
